import type { CommandContext, LoopResult } from "../types";

export async function handleAsr(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, t, traceId } = ctx;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const { data: link, error: linkErr } = await supabase
    .from("voice_temp_links")
    .insert({
      type: "asr",
      agent_id: agent.id,
      channel_id: channel?.id || null,
      config: {},
    })
    .select("id, expires_at")
    .single();
  if (linkErr || !link) {
    await sender.sendText(platformChatId, t("asrCreateFailed"));
    return { success: false, error: "Failed to create ASR link", traceId };
  }

  const asrUrl = `${appUrl}/voice/asr/${link.id}`;
  const asrText =
    t("asrTitle") +
    "\n\n" +
    t("asrLink", { url: asrUrl }) +
    "\n\n" +
    t("asrExpires", { time: new Date(link.expires_at).toLocaleString() }) +
    "\n\n" +
    t("asrSecurity");
  await sender.sendMarkdown(platformChatId, asrText);
  return { success: true, reply: asrUrl, traceId };
}

