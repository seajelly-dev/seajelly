import type { CommandContext, LoopResult } from "../types";

export async function handleCancel(ctx: CommandContext): Promise<LoopResult | null> {
  const { supabase, sender, platformChatId, session, t, traceId } = ctx;

  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  if (!meta.imgedit_pending) return null;

  await supabase
    .from("sessions")
    .update({ metadata: { ...meta, imgedit_pending: false, imgedit_prompt: null } })
    .eq("id", session.id);
  await sender.sendText(platformChatId, t("imgeditCancelled"));
  return { success: true, reply: "imgedit_cancelled", traceId };
}

