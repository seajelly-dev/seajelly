import type { CommandContext, LoopResult } from "../types";

export async function handleSkill(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, session, t, traceId } = ctx;

  const { data: skillRows } = await supabase
    .from("agent_skills")
    .select("skill_id, skills(id, name, description)")
    .eq("agent_id", agent.id);
  const skills = (skillRows ?? [])
    .map((row) => row.skills as unknown as { id: string; name: string; description: string })
    .filter(Boolean);
  if (skills.length === 0) {
    const msg = t("skillNone");
    await sender.sendMarkdown(platformChatId, msg);
    return { success: true, reply: "no_skills", traceId };
  }

  const activeIds: string[] = Array.isArray(session.active_skill_ids) ? session.active_skill_ids : [];
  const active = skills.filter((s) => activeIds.includes(s.id));
  const available = skills.filter((s) => !activeIds.includes(s.id));

  let text = t("skillTitle") + "\n\n";
  if (active.length > 0) {
    text += t("skillActive", { count: active.length }) + "\n";
    for (const s of active) text += `  • *${s.name}*${s.description ? ` — ${s.description}` : ""}\n`;
    text += "\n";
  }
  if (available.length > 0) {
    text += t("skillAvailable", { count: available.length }) + "\n";
    for (const s of available) text += `  • ${s.name}${s.description ? ` — ${s.description}` : ""}\n`;
    text += "\n";
  }
  text += t("skillAutoHint");

  await sender.sendMarkdown(platformChatId, text);
  return { success: true, reply: text, traceId };
}

