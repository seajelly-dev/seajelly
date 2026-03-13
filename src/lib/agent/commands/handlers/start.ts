import type { CommandContext, LoopResult } from "../types";

export async function handleStart(ctx: CommandContext): Promise<LoopResult> {
  const { sender, platformChatId, agent, t, traceId } = ctx;

  const prefix = "/";
  await sender.sendMarkdown(platformChatId, t("startGreeting", { agentName: agent.name, prefix }));
  return { success: true, reply: "start", traceId };
}

