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

  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("agent_knowledge_bases")
    .select("knowledge_base_id")
    .eq("agent_id", agentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    knowledge_base_ids: (data ?? []).map((r) => r.knowledge_base_id),
  });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { agent_id, knowledge_base_ids } = body;

  if (!agent_id || !Array.isArray(knowledge_base_ids)) {
    return NextResponse.json({ error: "agent_id and knowledge_base_ids required" }, { status: 400 });
  }

  const db = await createAdminClient();
  await db.from("agent_knowledge_bases").delete().eq("agent_id", agent_id);

  if (knowledge_base_ids.length > 0) {
    const rows = knowledge_base_ids.map((kbId: string) => ({
      agent_id,
      knowledge_base_id: kbId,
    }));
    const { error } = await db.from("agent_knowledge_bases").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, knowledge_base_ids });
}
