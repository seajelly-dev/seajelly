import type { CommandContext, LoopResult } from "../types";

export async function handleImageEdit(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, session, messageText, t, traceId } = ctx;

  const toolsConfig = (agent.tools_config ?? {}) as Record<string, boolean>;
  if (!toolsConfig.image_generate) {
    await sender.sendText(platformChatId, t("imgeditNotEnabled"));
    return { success: true, reply: "imgedit_not_enabled", traceId };
  }

  const editPrompt = messageText.replace(/^[/!]imgedit\s*/i, "").trim();
  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  await supabase
    .from("sessions")
    .update({ metadata: { ...meta, imgedit_pending: true, imgedit_prompt: editPrompt || null } })
    .eq("id", session.id);

  const msg = editPrompt ? t("imgeditPrompt", { prompt: editPrompt }) : t("imgeditNoPrompt");
  await sender.sendMarkdown(platformChatId, msg);
  return { success: true, reply: "imgedit_pending", traceId };
}

