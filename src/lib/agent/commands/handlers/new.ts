import { cleanupChannelTempFiles } from "@/lib/jellybox/storage";
import { cancelStaleEvents } from "@/lib/events/queue";
import type { CommandContext, LoopResult } from "../types";

export async function handleNew(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, session, event, t, traceId } = ctx;

  const cancelled = await cancelStaleEvents(platformChatId, agent.id, event.id ?? undefined);
  if (cancelled > 0) {
    console.log(`[new-command] trace=${traceId} cancelled ${cancelled} stale events for chat=${platformChatId}`);
  }

  await supabase.from("sessions").update({ is_active: false }).eq("id", session.id);
  await supabase.from("sessions").insert({
    platform_chat_id: platformChatId,
    agent_id: agent.id,
    channel_id: channel?.id || null,
    messages: [],
    active_skill_ids: [],
    version: 1,
    is_active: true,
  });

  if (channel?.id) {
    void cleanupChannelTempFiles(channel.id).catch((err) =>
      console.warn(`[new-command] trace=${traceId} temp cleanup failed for channel=${channel.id}:`, err),
    );
  }

  const msg = t("newSession");
  await sender.sendText(platformChatId, msg);
  return { success: true, reply: msg, traceId };
}
