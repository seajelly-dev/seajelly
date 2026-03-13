import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export interface InboundMessageParams {
  platform: string;
  agentId: string;
  platformChatId: string;
  platformUid: string | null;
  displayName?: string | null;
  text: string;
  fileRef?: string | null;
  fileMime?: string | null;
  fileName?: string | null;
  rawPayload: Record<string, unknown>;
  dedupKey: string;
}

export async function handleInboundMessage(params: InboundMessageParams): Promise<Response> {
  const {
    platform,
    agentId,
    platformChatId,
    platformUid,
    displayName,
    text,
    fileRef,
    fileMime,
    fileName,
    rawPayload,
    dedupKey,
  } = params;

  const supabase = getSupabase();

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
      .eq("platform", platform)
      .eq("platform_uid", platformUid)
      .single();

    if (channel && !channel.is_allowed) {
      return NextResponse.json({ ok: true, blocked: true });
    }
  }

  const { error: insertErr } = await supabase.from("events").insert({
    source: platform,
    agent_id: agentId,
    platform_chat_id: platformChatId,
    dedup_key: dedupKey,
    payload: {
      platform,
      update_id: rawPayload.update_id,
      platform_uid: platformUid,
      display_name: displayName || null,
      message: {
        text,
        file_id: fileRef || null,
        file_mime: fileMime || null,
        file_name: fileName || null,
        ...rawPayload.message_extra as Record<string, unknown>,
      },
    },
    status: "pending",
  });

  if (insertErr) {
    console.error(`[webhook-handler] event insert failed: platform=${platform} agent=${agentId} err=${insertErr.message}`);
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  console.log(`[webhook-handler] event created: platform=${platform} agent=${agentId} chat=${platformChatId} hasFile=${!!fileRef} fileMime=${fileMime}`);

  after(async () => {
    try {
      const { claimPendingEvents, markProcessed, markFailed } = await import("@/lib/events/queue");
      const { runAgentLoop } = await import("@/lib/agent/loop");
      const events = await claimPendingEvents();
      console.log(`[webhook-handler] after() claimed ${events.length} events`);
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
      console.error("[webhook-handler] after() worker error:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
