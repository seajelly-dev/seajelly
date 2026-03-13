import type { CommandContext, LoopResult } from "../types";

export async function handleWhoami(ctx: CommandContext): Promise<LoopResult> {
  const { sender, platformChatId, channel, t, traceId } = ctx;

  const whoamiText = channel
    ? t("whoamiTitle") +
      "\n\n" +
      t("whoamiUid", { uid: channel.platform_uid }) +
      "\n" +
      t("whoamiName", { name: channel.display_name || "N/A" }) +
      "\n" +
      t("whoamiAllowed", { status: channel.is_allowed ? "✅" : "⛔" }) +
      "\n\n" +
      t("whoamiSoul", { soul: channel.user_soul || "(empty)" })
    : t("noChannelRecord");

  await sender.sendMarkdown(platformChatId, whoamiText);
  return { success: true, reply: whoamiText, traceId };
}

