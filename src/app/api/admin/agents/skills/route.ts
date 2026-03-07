import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId) {
    return NextResponse.json(
      { error: "agent_id is required" },
      { status: 400 }
    );
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("agent_skills")
    .select("skill_id")
    .eq("agent_id", agentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const skillIds = (data ?? []).map((r) => r.skill_id);
  return NextResponse.json({ skill_ids: skillIds });
}

export async function PUT(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { agent_id, skill_ids } = body;

  if (!agent_id) {
    return NextResponse.json(
      { error: "agent_id is required" },
      { status: 400 }
    );
  }

  const db = await createAdminClient();

  const { error: delError } = await db
    .from("agent_skills")
    .delete()
    .eq("agent_id", agent_id);

  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  const ids = (skill_ids as string[]) || [];
  if (ids.length > 0) {
    const rows = ids.map((sid: string) => ({
      agent_id,
      skill_id: sid,
    }));
    const { error: insError } = await db.from("agent_skills").insert(rows);
    if (insError) {
      return NextResponse.json({ error: insError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, skill_ids: ids });
}
