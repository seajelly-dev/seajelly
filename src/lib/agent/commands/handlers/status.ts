import type { CommandContext, LoopResult } from "../types";

export async function handleStatus(ctx: CommandContext): Promise<LoopResult> {
  const { sender, platformChatId, agent, session, t, traceId } = ctx;

  const msgCount = Array.isArray(session.messages) ? session.messages.length : 0;
  const statusText =
    t("statusTitle") +
    "\n\n" +
    t("statusAgent", { agentName: agent.name }) +
    "\n" +
    t("statusModel", { model: agent.model }) +
    "\n" +
    t("statusAccessMode", { accessMode: agent.access_mode }) +
    "\n" +
    t("statusMessages", { count: msgCount });

  await sender.sendMarkdown(platformChatId, statusText);
  return { success: true, reply: statusText, traceId };
}

