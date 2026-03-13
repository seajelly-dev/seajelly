import type { CommandContext, LoopResult } from "../types";

export async function handleLive(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, t, traceId } = ctx;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const { data: link, error: linkErr } = await supabase
    .from("voice_temp_links")
    .insert({
      type: "live",
      agent_id: agent.id,
      channel_id: channel?.id || null,
      config: {},
    })
    .select("id, expires_at")
    .single();
  if (linkErr || !link) {
    await sender.sendText(platformChatId, t("liveCreateFailed"));
    return { success: false, error: "Failed to create live link", traceId };
  }

  const liveUrl = `${appUrl}/voice/live/${link.id}`;
  const liveText =
    t("liveTitle") +
    "\n\n" +
    t("liveLink", { url: liveUrl }) +
    "\n\n" +
    t("liveExpires", { time: new Date(link.expires_at).toLocaleString() }) +
    "\n\n" +
    t("liveSecurity");
  await sender.sendMarkdown(platformChatId, liveText);
  return { success: true, reply: liveUrl, traceId };
}

