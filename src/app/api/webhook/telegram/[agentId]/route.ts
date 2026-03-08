import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    const supabaseInit = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: agentRow } = await supabaseInit
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

    const message = body.message || body.edited_message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const hasText = !!message.text;
    const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const hasDocument = message.document?.mime_type?.startsWith("image/");
    if (!hasText && !hasPhoto && !hasDocument) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text || message.caption || "";
    const chatId = message.chat.id;
    const updateId = body.update_id;
    const dedupKey = `tg:${agentId}:${chatId}:${updateId}`;
    const platformUid = message.from?.id ? String(message.from.id) : null;

    const supabase = supabaseInit;

    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, dedup: true });
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("id, access_mode")
      .eq("id", agentId)
      .single();

    if (!agent) {
      return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });
    }

    if (platformUid) {
      const { data: channel } = await supabase
        .from("channels")
        .select("is_allowed")
        .eq("agent_id", agentId)
        .eq("platform", "telegram")
        .eq("platform_uid", platformUid)
        .single();

      if (channel && !channel.is_allowed) {
        return NextResponse.json({ ok: true, blocked: true });
      }
      if (!channel && agent.access_mode === "whitelist") {
        return NextResponse.json({ ok: true, blocked: true });
      }
    }

    let photoFileId: string | null = null;
    if (hasPhoto) {
      photoFileId = message.photo[message.photo.length - 1].file_id;
    } else if (hasDocument) {
      photoFileId = message.document.file_id;
    }

    await supabase.from("events").insert({
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
          photo_file_id: photoFileId,
        },
      },
      status: "pending",
    });

    after(async () => {
      try {
        const { claimPendingEvents, markProcessed, markFailed } = await import("@/lib/events/queue");
        const { runAgentLoop } = await import("@/lib/agent/loop");
        const events = await claimPendingEvents();
        for (const event of events) {
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
        }
      } catch (err) {
        console.error("after() worker error:", err);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
