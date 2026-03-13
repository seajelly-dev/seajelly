import type { CommandContext, LoopResult } from "../types";

export async function handleNew(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, session, t, traceId } = ctx;

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

  const msg = t("newSession");
  await sender.sendText(platformChatId, msg);
  return { success: true, reply: msg, traceId };
}

