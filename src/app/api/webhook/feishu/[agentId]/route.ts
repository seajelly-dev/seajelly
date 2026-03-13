import { NextResponse } from "next/server";
import crypto from "crypto";
import { decrypt } from "@/lib/crypto/encrypt";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval, getAgentLocale } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";
import { getFeishuUserName } from "@/lib/platform/adapters/feishu";
import { botT, getBotLocaleOrDefault, buildWelcomeText } from "@/lib/i18n/bot";
import { createStrictServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function getSupabase() {
  return createStrictServiceClient();
}

function decryptFeishuEvent(encrypt: string, encryptKey: string): string {
  const buf = Buffer.from(encrypt, "base64");
  const keyHash = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = buf.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
  let decrypted = decipher.update(buf.subarray(16));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

async function getFeishuCredentials(agentId: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "feishu")
    .in("credential_type", ["encrypt_key", "verification_token"]);

  const credentials: Record<string, string> = {};
  for (const row of data || []) {
    credentials[row.credential_type] = decrypt(row.encrypted_value);
  }

  return {
    encryptKey: credentials.encrypt_key || null,
    verificationToken: credentials.verification_token || null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    let body = await request.json();
    const { encryptKey, verificationToken } = await getFeishuCredentials(agentId);

    if (body.encrypt) {
      if (!encryptKey) {
        return NextResponse.json({ error: "No encrypt key configured" }, { status: 500 });
      }
      body = JSON.parse(decryptFeishuEvent(body.encrypt, encryptKey));
    }

    if (!verificationToken || body.token !== verificationToken) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (body.challenge) {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Card action callback (approval buttons)
    if (body.type === "interactive" || body.header?.event_type === "card.action.trigger") {
      const action = body.action || body.event?.action;
      const value = action?.value as Record<string, string> | undefined;
      const actionStr = value?.action || "";
      const match = actionStr.match(/^(approve|reject):(.+)$/);

      if (match) {
        const [, act, channelId] = match;
        const openId = body.open_id || body.event?.operator?.open_id || "";
        const result = await processChannelApproval({
          action: act as "approve" | "reject",
          channelId,
          callerUid: openId,
          fallbackAgentId: agentId,
        });

        const rawLocale = await getAgentLocale(agentId);
        const locale = getBotLocaleOrDefault(rawLocale);

        if (!result) {
          return NextResponse.json({
            config: { wide_screen_mode: true },
            elements: [{ tag: "div", text: { tag: "plain_text", content: botT(locale, "alreadyProcessedDot") } }],
          });
        }

        if (result.targetUid) {
          try {
            const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
            await targetSender.sendText(
              result.targetUid,
              act === "approve"
                ? botT(locale, "accessApproved")
                : botT(locale, "accessRejected"),
            );
            if (act === "approve") {
              const { data: aRow } = await getSupabase().from("agents").select("name").eq("id", result.agentId).single();
              const agentName = (aRow as { name?: string } | null)?.name || "Agent";
              const welcomeText = buildWelcomeText(locale, agentName, result.targetPlatform);
              await targetSender.sendMarkdown(result.targetUid, welcomeText);
            }
          } catch { /* target unreachable */ }
        }

        const label = act === "approve"
          ? botT(locale, "approved", { name: result.name })
          : botT(locale, "rejected", { name: result.name });
        return NextResponse.json({
          config: { wide_screen_mode: true },
          elements: [{ tag: "div", text: { tag: "plain_text", content: label } }],
        });
      }
      return NextResponse.json({});
    }

    const header = body.header;
    if (!header || header.event_type !== "im.message.receive_v1") {
      return NextResponse.json({ ok: true });
    }

    const event = body.event;
    const msg = event?.message;
    if (!msg) return NextResponse.json({ ok: true });

    const chatId = msg.chat_id;
    const senderId = event.sender?.sender_id?.open_id || null;
    const msgType = msg.message_type;

    let senderName: string | null = null;
    if (senderId) {
      senderName = await getFeishuUserName(agentId, senderId, chatId);
    }
    const messageId = msg.message_id;

    let text = "";
    let fileRef: string | null = null;
    let fileMime: string | null = null;

    if (msgType === "text") {
      try {
        const parsed = JSON.parse(msg.content);
        text = parsed.text || "";
      } catch {
        text = msg.content || "";
      }
    } else if (msgType === "post") {
      try {
        const parsed = JSON.parse(msg.content);
        // Received post: direct { content: [[...]] } or nested { zh_cn: { content: [[...]] } }
        let rows: Array<Array<Record<string, string>>> | undefined;
        if (Array.isArray(parsed.content)) {
          rows = parsed.content;
        } else {
          const lang = parsed.zh_cn || parsed.en_us;
          if (lang && Array.isArray(lang.content)) {
            rows = lang.content;
          }
        }
        if (rows) {
          const texts: string[] = [];
          let firstImageKey: string | null = null;
          for (const row of rows) {
            for (const el of row) {
              if (el.tag === "text") texts.push(el.text || "");
              else if (el.tag === "a") texts.push(el.text || el.href || "");
              else if (el.tag === "img" && !firstImageKey) firstImageKey = el.image_key;
            }
          }
          text = texts.join("").trim();
          if (firstImageKey) {
            fileRef = `${messageId}|${firstImageKey}|image`;
            fileMime = "image/jpeg";
          }
        }
      } catch {
        /* skip */
      }
    } else if (msgType === "audio" || msgType === "file" || msgType === "image") {
      try {
        const parsed = JSON.parse(msg.content);
        const key = parsed.file_key || parsed.image_key || null;
        if (key) {
          const resType = msgType === "image" ? "image" : "file";
          fileRef = `${messageId}|${key}|${resType}`;
        }
        if (msgType === "file" && parsed.file_name) {
          const fn = (parsed.file_name as string).toLowerCase();
          if (fn.endsWith(".pdf")) fileMime = "application/pdf";
          else if (fn.endsWith(".doc") || fn.endsWith(".docx")) fileMime = "application/msword";
          else if (fn.endsWith(".xls") || fn.endsWith(".xlsx")) fileMime = "application/vnd.ms-excel";
          else if (fn.endsWith(".png")) fileMime = "image/png";
          else if (fn.endsWith(".jpg") || fn.endsWith(".jpeg")) fileMime = "image/jpeg";
        }
      } catch {
        /* skip */
      }
      if (!fileMime) {
        if (msgType === "audio") fileMime = "audio/opus";
        else if (msgType === "image") fileMime = "image/jpeg";
      }
    } else {
      return NextResponse.json({ ok: true });
    }

    return handleInboundMessage({
      platform: "feishu",
      agentId,
      platformChatId: chatId,
      platformUid: senderId,
      displayName: senderName,
      text,
      fileRef,
      fileMime,
      rawPayload: {
        update_id: messageId,
        message_extra: {
          message_id: messageId,
          sender: event.sender,
          chat_type: msg.chat_type,
        },
      },
      dedupKey: `feishu:${agentId}:${chatId}:${messageId}`,
    });
  } catch (err) {
    console.error("Feishu webhook error:", err);
    return NextResponse.json({ error: "Failed to handle webhook" }, { status: 500 });
  }
}
