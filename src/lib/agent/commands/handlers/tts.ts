import type { CommandContext, LoopResult } from "../types";

export async function handleTts(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, t, traceId } = ctx;

  if (!channel?.is_owner) {
    const msg = t("ttsOwnerOnly");
    await sender.sendText(platformChatId, msg);
    return { success: true, reply: "tts_denied", traceId };
  }

  const currentConfig = (agent.tools_config ?? {}) as Record<string, boolean>;
  const isEnabled = !!currentConfig.tts_speak;
  const newConfig = { ...currentConfig, tts_speak: !isEnabled };

  await supabase.from("agents").update({ tools_config: newConfig }).eq("id", agent.id);

  const ttsMsg = !isEnabled
    ? t("ttsEnabled", { agentName: agent.name })
    : t("ttsDisabled", { agentName: agent.name });
  await sender.sendMarkdown(platformChatId, ttsMsg);

  return { success: true, reply: `tts_${!isEnabled ? "enabled" : "disabled"}`, traceId };
}

