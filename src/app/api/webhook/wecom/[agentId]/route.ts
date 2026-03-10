import { NextResponse } from "next/server";
import {
  resolveWeComCredentials,
  decryptWeComMsg,
  verifyWeComSignature,
} from "@/lib/platform/adapters/wecom";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = new RegExp(
    "<(\\w+)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/\\1>|<(\\w+)>([\\s\\S]*?)<\\/\\3>",
    "g",
  );
  let match;
  while ((match = regex.exec(xml)) !== null) {
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
    const outerXml = parseXml(rawBody);
    const encryptedMsg = outerXml.Encrypt;
    if (!encryptedMsg) {
      return NextResponse.json({ ok: true });
    }

    const creds = await resolveWeComCredentials(agentId);
    const expectedSig = verifyWeComSignature(creds.token, timestamp, nonce, encryptedMsg);
    if (expectedSig !== msgSignature) {
      return new Response("Signature mismatch", { status: 403 });
    }

    const decryptedXml = decryptWeComMsg(encryptedMsg, creds.encodingAesKey);
    const msg = parseXml(decryptedXml);

    const msgType = msg.MsgType;
    if (!msgType) return NextResponse.json({ ok: true });

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
