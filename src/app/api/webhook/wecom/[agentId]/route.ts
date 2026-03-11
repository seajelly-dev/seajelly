import { NextResponse } from "next/server";
import {
  resolveWeComCredentials,
  decryptWeComMsg,
  verifyWeComSignature,
} from "@/lib/platform/adapters/wecom";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const inner = xml.replace(/^<xml>|<\/xml>$/g, "").trim();
  const regex = new RegExp(
    "<(\\w+)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/\\1>|<(\\w+)>([\\s\\S]*?)<\\/\\3>",
    "g",
  );
  let match;
  while ((match = regex.exec(inner)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] ?? match[4] ?? "";
    result[key] = value;
  }
  return result;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const msgSignature = url.searchParams.get("msg_signature") || "";
    const timestamp = url.searchParams.get("timestamp") || "";
    const nonce = url.searchParams.get("nonce") || "";
    const echostr = url.searchParams.get("echostr") || "";

    const creds = await resolveWeComCredentials(agentId);
    const expectedSig = verifyWeComSignature(creds.token, timestamp, nonce, echostr);
    if (expectedSig !== msgSignature) {
      return new Response("Signature mismatch", { status: 403 });
    }

    const decrypted = decryptWeComMsg(echostr, creds.encodingAesKey);
    return new Response(decrypted, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    console.error("WeCom URL verification error:", err);
    return new Response("Error", { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const msgSignature = url.searchParams.get("msg_signature") || "";
    const timestamp = url.searchParams.get("timestamp") || "";
    const nonce = url.searchParams.get("nonce") || "";

    const rawBody = await request.text();
    console.log("WeCom POST:", agentId, "body_len:", rawBody.length, "body_prefix:", rawBody.slice(0, 200));

    const outerXml = parseXml(rawBody);
    const encryptedMsg = outerXml.Encrypt;
    if (!encryptedMsg) {
      console.log("WeCom POST: no Encrypt field, keys:", Object.keys(outerXml));
      return NextResponse.json({ ok: true });
    }

    const creds = await resolveWeComCredentials(agentId);
    const expectedSig = verifyWeComSignature(creds.token, timestamp, nonce, encryptedMsg);
    if (expectedSig !== msgSignature) {
      console.log("WeCom POST: sig mismatch, expected:", expectedSig, "got:", msgSignature);
      return new Response("Signature mismatch", { status: 403 });
    }

    const decryptedXml = decryptWeComMsg(encryptedMsg, creds.encodingAesKey);
    console.log("WeCom POST: decrypted_len:", decryptedXml.length, "decrypted_prefix:", decryptedXml.slice(0, 300));
    const msg = parseXml(decryptedXml);
    console.log("WeCom POST: parsed msg keys:", Object.keys(msg), "MsgType:", msg.MsgType, "Content:", msg.Content?.slice(0, 100));

    const msgType = msg.MsgType;
    if (!msgType) {
      console.log("WeCom POST: no MsgType in decrypted xml");
      return NextResponse.json({ ok: true });
    }

    // Template card button callback (approval)
    if (msgType === "event" && msg.Event === "template_card_event") {
      const eventKey = msg.EventKey || "";
      const callerUid = msg.FromUserName || "";
      const match = eventKey.match(/^(approve|reject):(.+)$/);
      if (match) {
        const [, act, channelId] = match;
        const result = await processChannelApproval({
          action: act as "approve" | "reject",
          channelId,
          callerUid,
          fallbackAgentId: agentId,
        });

        const ownerSender = await getSenderForAgent(agentId, "wecom");
        if (!result) {
          await ownerSender.sendText(callerUid, "⚠️ Already processed.").catch(() => {});
        } else {
          const label = act === "approve" ? `✅ Approved: ${result.name}` : `❌ Rejected: ${result.name}`;
          await ownerSender.sendText(callerUid, label).catch(() => {});

          if (result.targetUid) {
            try {
              const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
              await targetSender.sendText(
                result.targetUid,
                act === "approve"
                  ? "✅ Your access has been approved! You can start chatting now."
                  : "❌ Your access request has been rejected.",
              );
            } catch { /* target unreachable */ }
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    const fromUser = msg.FromUserName || "";
    const msgId = msg.MsgId || `${Date.now()}`;

    let text = "";
    let fileRef: string | null = null;
    let fileMime: string | null = null;

    if (msgType === "text") {
      text = msg.Content || "";
    } else if (msgType === "voice") {
      fileRef = msg.MediaId || null;
      fileMime = msg.Format ? `audio/${msg.Format}` : "audio/amr";
      text = msg.Recognition || "";
    } else if (msgType === "image") {
      fileRef = msg.MediaId || null;
      fileMime = "image/jpeg";
    } else {
      return NextResponse.json({ ok: true });
    }

    return handleInboundMessage({
      platform: "wecom",
      agentId,
      platformChatId: fromUser,
      platformUid: fromUser,
      displayName: null,
      text,
      fileRef,
      fileMime,
      rawPayload: {
        update_id: msgId,
        message_extra: {
          msg_id: msgId,
          msg_type: msgType,
          create_time: msg.CreateTime,
          agent_id_wecom: msg.AgentID,
        },
      },
      dedupKey: `wecom:${agentId}:${fromUser}:${msgId}`,
    });
  } catch (err) {
    console.error("WeCom webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
