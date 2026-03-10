import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: agentRow } = await supabase
      .from("agents")
      .select("webhook_secret")
      .eq("id", agentId)
      .single();
    const webhookSecret = agentRow?.webhook_secret;
    if (!webhookSecret && process.env.NODE_ENV === "production") {
      console.error(`Webhook secret missing for agent ${agentId} — rejecting request (fail-close)`);
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    if (webhookSecret) {
      const incoming = request.headers.get("x-telegram-bot-api-secret-token");
      if (incoming !== webhookSecret) {
        return NextResponse.json({ ok: false }, { status: 403 });
      }
    }

    const body = await request.json();

    if (body.callback_query) {
      const { handleApprovalCallback } = await import("@/lib/telegram/approval");
      await handleApprovalCallback(body.callback_query, agentId);
      return NextResponse.json({ ok: true });
    }

    const message = body.message || body.edited_message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const hasText = !!message.text;
    const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const hasVideo = !!message.video;
    const hasDocument = !!message.document;
    const hasVoice = !!message.voice;
    const hasAudio = !!message.audio;
    if (!hasText && !hasPhoto && !hasVideo && !hasDocument && !hasVoice && !hasAudio) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text || message.caption || "";
    const chatId = message.chat.id;
    const updateId = body.update_id;
    const platformUid = message.from?.id ? String(message.from.id) : null;
    const displayName = message.from?.first_name || null;

    let fileRef: string | null = null;
    let fileMime: string | null = null;
    let fileName: string | null = null;
    if (hasPhoto) {
      fileRef = message.photo[message.photo.length - 1].file_id;
      fileMime = "image/jpeg";
    } else if (hasVideo) {
      fileRef = message.video.file_id;
      fileMime = message.video.mime_type || "video/mp4";
    } else if (hasDocument) {
      fileRef = message.document.file_id;
      fileMime = message.document.mime_type || "application/octet-stream";
      fileName = message.document.file_name || null;
    } else if (hasVoice) {
      fileRef = message.voice.file_id;
      fileMime = message.voice.mime_type || "audio/ogg";
    } else if (hasAudio) {
      fileRef = message.audio.file_id;
      fileMime = message.audio.mime_type || "audio/mpeg";
    }

    return handleInboundMessage({
      platform: "telegram",
      agentId,
      platformChatId: String(chatId),
      platformUid,
      displayName,
      text,
      fileRef,
      fileMime,
      fileName,
      rawPayload: {
        update_id: updateId,
        message_extra: {
          message_id: message.message_id,
          from: message.from,
          chat: message.chat,
          date: message.date,
        },
      },
      dedupKey: `tg:${agentId}:${chatId}:${updateId}`,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
