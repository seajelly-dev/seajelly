import { buildHelpText } from "@/lib/i18n/bot";
import type { CommandContext, LoopResult } from "../types";

export async function handleHelp(ctx: CommandContext): Promise<LoopResult> {
  const { sender, platformChatId, agent, platform, locale, traceId } = ctx;

  const helpText = buildHelpText(locale, agent.name, platform);
  await sender.sendMarkdown(platformChatId, helpText);
  return { success: true, reply: helpText, traceId };
}

