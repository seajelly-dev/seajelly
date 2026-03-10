import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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

async function getEncryptKey(agentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("agent_credentials")
    .select("encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "feishu")
    .eq("credential_type", "encrypt_key")
    .single();
  return data?.encrypted_value ? decrypt(data.encrypted_value) : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    let body = await request.json();

    if (body.encrypt) {
      const encryptKey = await getEncryptKey(agentId);
      if (!encryptKey) {
        return NextResponse.json({ error: "No encrypt key configured" }, { status: 500 });
      }
      body = JSON.parse(decryptFeishuEvent(body.encrypt, encryptKey));
    }

    if (body.challenge) {
      return NextResponse.json({ challenge: body.challenge });
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
    const senderName = event.sender?.sender_id?.name || null;
    const msgType = msg.message_type;
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
    } else if (msgType === "audio" || msgType === "file" || msgType === "image") {
      try {
        const parsed = JSON.parse(msg.content);
        fileRef = parsed.file_key || parsed.image_key || null;
      } catch {
        /* skip */
      }
      if (msgType === "audio") fileMime = "audio/opus";
      else if (msgType === "image") fileMime = "image/jpeg";
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
    return NextResponse.json({ ok: true });
  }
}
