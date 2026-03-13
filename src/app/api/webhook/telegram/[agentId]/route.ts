import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

type TelegramMessage = Record<string, unknown>;

function pickTelegramMessage(body: Record<string, unknown>): TelegramMessage | null {
  return (
    (body.message as TelegramMessage | undefined) ||
    (body.edited_message as TelegramMessage | undefined) ||
    (body.channel_post as TelegramMessage | undefined) ||
    (body.edited_channel_post as TelegramMessage | undefined) ||
    (body.business_message as TelegramMessage | undefined) ||
    (body.edited_business_message as TelegramMessage | undefined) ||
    null
  );
}

function extractTelegramFile(message: TelegramMessage): { fileRef: string | null; fileMime: string | null; fileName: string | null } {
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
  const hasVideo = !!message.video;
  const hasDocument = !!message.document;
  const hasVoice = !!message.voice;
  const hasAudio = !!message.audio;
  const hasSticker = !!message.sticker;
  const hasAnimation = !!message.animation;
  const hasVideoNote = !!message.video_note;

  if (hasPhoto) {
    const photo = message.photo as Array<{ file_id: string }>;
    return { fileRef: photo[photo.length - 1]?.file_id ?? null, fileMime: "image/jpeg", fileName: null };
  }
  if (hasVideo) {
    const video = message.video as { file_id: string; mime_type?: string };
    return { fileRef: video.file_id, fileMime: video.mime_type || "video/mp4", fileName: null };
  }
  if (hasDocument) {
    const document = message.document as { file_id: string; mime_type?: string; file_name?: string };
    return {
      fileRef: document.file_id,
      fileMime: document.mime_type || "application/octet-stream",
      fileName: document.file_name || null,
    };
  }
  if (hasVoice) {
    const voice = message.voice as { file_id: string; mime_type?: string };
    return { fileRef: voice.file_id, fileMime: voice.mime_type || "audio/ogg", fileName: null };
  }
  if (hasAudio) {
    const audio = message.audio as { file_id: string; mime_type?: string; file_name?: string };
    return {
      fileRef: audio.file_id,
      fileMime: audio.mime_type || "audio/mpeg",
      fileName: audio.file_name || null,
    };
  }
  if (hasSticker) {
    const sticker = message.sticker as { file_id: string; is_video?: boolean; is_animated?: boolean };
    const stickerMime = sticker.is_video ? "video/webm" : sticker.is_animated ? "application/x-tgsticker" : "image/webp";
    return { fileRef: sticker.file_id, fileMime: stickerMime, fileName: null };
  }
  if (hasAnimation) {
    const animation = message.animation as { file_id: string; mime_type?: string; file_name?: string };
    return {
      fileRef: animation.file_id,
      fileMime: animation.mime_type || "video/mp4",
      fileName: animation.file_name || null,
    };
  }
  if (hasVideoNote) {
    const videoNote = message.video_note as { file_id: string };
    return { fileRef: videoNote.file_id, fileMime: "video/mp4", fileName: null };
  }

  for (const [key, value] of Object.entries(message)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        const item = value[i] as Record<string, unknown> | undefined;
        const candidate = item?.file_id;
        if (typeof candidate === "string" && candidate) {
          const mime =
            (typeof item?.mime_type === "string" && item.mime_type) ||
            (key.includes("photo") ? "image/jpeg" : "application/octet-stream");
          return { fileRef: candidate, fileMime: mime, fileName: null };
        }
      }
      continue;
    }
    if (typeof value === "object") {
      const rec = value as Record<string, unknown>;
      const candidate = rec.file_id;
      if (typeof candidate === "string" && candidate) {
        const mime =
          (typeof rec.mime_type === "string" && rec.mime_type) ||
          (key.includes("photo") ? "image/jpeg" : "application/octet-stream");
        const fileName = typeof rec.file_name === "string" ? rec.file_name : null;
        return { fileRef: candidate, fileMime: mime, fileName };
      }
    }
  }
  return { fileRef: null, fileMime: null, fileName: null };
}

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

    const parsedBody = body as Record<string, unknown>;
    const message = pickTelegramMessage(parsedBody);
    if (!message) {
      console.log(`[tg-webhook:${agentId}] skip: no message object, keys=${Object.keys(parsedBody).join(",")}`);
      return NextResponse.json({ ok: true });
    }

    const hasText = !!message.text || !!message.caption;
    const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const hasVideo = !!message.video;
    const hasDocument = !!message.document;
    const hasVoice = !!message.voice;
    const hasAudio = !!message.audio;
    const hasSticker = !!message.sticker;
    const hasAnimation = !!message.animation;
    const hasVideoNote = !!message.video_note;
    const extractedFile = extractTelegramFile(message);
    if (
      !hasText &&
      !hasPhoto &&
      !hasVideo &&
      !hasDocument &&
      !hasVoice &&
      !hasAudio &&
      !hasSticker &&
      !hasAnimation &&
      !hasVideoNote &&
      !extractedFile.fileRef
    ) {
      console.log(`[tg-webhook:${agentId}] skip: unsupported message keys=${Object.keys(message).join(",")}`);
      return NextResponse.json({ ok: true });
    }

    const text = (message.text as string) || (message.caption as string) || "";
    const chatId =
      ((message.chat as { id?: number } | undefined)?.id) ??
      ((message.sender_chat as { id?: number } | undefined)?.id);
    if (!chatId) {
      console.warn(`[tg-webhook:${agentId}] skip: missing chat id`);
      return NextResponse.json({ ok: true });
    }
    const updateId = body.update_id;
    const platformUid =
      ((message.from as { id?: number } | undefined)?.id
        ? String((message.from as { id: number }).id)
        : ((message.sender_chat as { id?: number } | undefined)?.id
            ? `chat:${(message.sender_chat as { id: number }).id}`
            : null));
    const displayName =
      ((message.from as { first_name?: string } | undefined)?.first_name) ||
      ((message.sender_chat as { title?: string } | undefined)?.title) ||
      null;

    const { fileRef, fileMime, fileName } = extractedFile;

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
