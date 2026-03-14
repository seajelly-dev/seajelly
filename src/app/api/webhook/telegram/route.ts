import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";

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

export async function POST(request: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: defaultAgent } = await supabase
      .from("agents")
      .select("id, access_mode, webhook_secret")
      .eq("is_default", true)
      .limit(1)
      .single();

    const webhookSecret = defaultAgent?.webhook_secret;
    if (!webhookSecret && process.env.NODE_ENV === "production") {
      console.error("Webhook secret missing for default agent — rejecting request (fail-close)");
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
      await handleApprovalCallback(body.callback_query, defaultAgent?.id ?? null);
      return NextResponse.json({ ok: true });
    }

    const parsedBody = body as Record<string, unknown>;
    const message = pickTelegramMessage(parsedBody);
    if (!message) {
      console.log(`[tg-webhook:default] skip: no message object, keys=${Object.keys(parsedBody).join(",")}`);
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
      console.log(`[tg-webhook:default] skip: unsupported message keys=${Object.keys(message).join(",")}`);
      return NextResponse.json({ ok: true });
    }

    const text = (message.text as string) || (message.caption as string) || "";
    const chatId =
      ((message.chat as { id?: number } | undefined)?.id) ??
      ((message.sender_chat as { id?: number } | undefined)?.id);
    if (!chatId) {
      console.warn("[tg-webhook:default] skip: missing chat id");
      return NextResponse.json({ ok: true });
    }
    const updateId = body.update_id;
    const dedupKey = `tg:${chatId}:${updateId}`;
    const platformUid =
      ((message.from as { id?: number } | undefined)?.id
        ? String((message.from as { id: number }).id)
        : ((message.sender_chat as { id?: number } | undefined)?.id
            ? `chat:${(message.sender_chat as { id: number }).id}`
            : null));

    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, dedup: true });
    }

    const agentId = defaultAgent?.id ?? null;

    if (agentId && platformUid) {
      const { data: channel } = await supabase
        .from("channels")
        .select("is_allowed")
        .eq("agent_id", agentId)
        .eq("platform", "telegram")
        .eq("platform_uid", platformUid)
        .single();

      if (channel && !channel.is_allowed) {
        console.log(`[tg-webhook:default] blocked existing channel: agent=${agentId} uid=${platformUid}`);
        return NextResponse.json({ ok: true, blocked: true });
      }

      if (!channel && defaultAgent?.access_mode === "whitelist") {
        console.log(`[tg-webhook:default] blocked whitelist new uid: agent=${agentId} uid=${platformUid}`);
        return NextResponse.json({ ok: true, blocked: true });
      }
      // approval mode: let unknown users through so loop.ts creates the pending channel
    }

    const { fileRef: fileId, fileMime, fileName } = extractedFile;

    const { data: inserted, error: insertErr } = await supabase.from("events").insert({
      source: "telegram",
      agent_id: agentId,
      platform_chat_id: String(chatId),
      dedup_key: dedupKey,
      payload: {
        update_id: updateId,
        platform_uid: platformUid,
        message: {
          message_id: message.message_id,
          text,
          from: message.from,
          chat: message.chat,
          date: message.date,
          file_id: fileId,
          file_mime: fileMime,
          file_name: fileName,
        },
      },
      status: "pending",
    }).select("id").single();

    if (insertErr || !inserted) {
      console.error(`[tg-webhook] event insert failed: agent=${agentId} err=${insertErr?.message}`);
      return NextResponse.json({ ok: true });
    }

    const insertedEventId = inserted.id as string;
    console.log(`[tg-webhook] event created: agent=${agentId} chat=${chatId} hasFile=${!!fileId} fileMime=${fileMime} textLen=${text.length}`);

    after(async () => {
      try {
        const { claimEventById, markProcessed, markFailed } = await import("@/lib/events/queue");
        const { runAgentLoop } = await import("@/lib/agent/loop");
        const event = await claimEventById(insertedEventId);
        if (!event) {
          console.log(`[tg-webhook] after() event ${insertedEventId} already claimed or cancelled`);
          return;
        }
        console.log(`[tg-webhook] after() claimed event ${event.id}`);
        try {
          const result = await runAgentLoop(event);
          if (result.success) {
            await markProcessed(event.id);
          } else {
            await markFailed(event.id, result.error ?? "Unknown failure");
          }
        } catch (err) {
          await markFailed(event.id, err instanceof Error ? err.message : "Unknown error");
        }
      } catch (err) {
        console.error("[tg-webhook] after() worker error:", err);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
