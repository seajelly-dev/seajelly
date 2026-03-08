import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const skillId = searchParams.get("skill_id");

  const db = await createAdminClient();

  if (agentId) {
    const { data, error } = await db
      .from("agent_skills")
      .select("skill_id")
      .eq("agent_id", agentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ skill_ids: (data ?? []).map((r) => r.skill_id) });
  }

  if (skillId) {
    const { data, error } = await db
      .from("agent_skills")
      .select("agent_id")
      .eq("skill_id", skillId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ agent_ids: (data ?? []).map((r) => r.agent_id) });
  }

  return NextResponse.json({ error: "agent_id or skill_id required" }, { status: 400 });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { agent_id, skill_ids, skill_id, agent_ids } = body;
  const db = await createAdminClient();

  if (agent_id && Array.isArray(skill_ids)) {
    await db.from("agent_skills").delete().eq("agent_id", agent_id);
    if (skill_ids.length > 0) {
      const rows = skill_ids.map((sid: string) => ({ agent_id, skill_id: sid }));
      const { error } = await db.from("agent_skills").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, skill_ids });
  }

  if (skill_id && Array.isArray(agent_ids)) {
    await db.from("agent_skills").delete().eq("skill_id", skill_id);
    if (agent_ids.length > 0) {
      const rows = agent_ids.map((aid: string) => ({ agent_id: aid, skill_id }));
      const { error } = await db.from("agent_skills").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, agent_ids });
  }

  return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
}
