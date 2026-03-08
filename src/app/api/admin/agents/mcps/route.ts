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
  const mcpServerId = searchParams.get("mcp_server_id");

  const db = await createAdminClient();

  if (agentId) {
    const { data, error } = await db
      .from("agent_mcps")
      .select("mcp_server_id")
      .eq("agent_id", agentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ mcp_server_ids: (data ?? []).map((r) => r.mcp_server_id) });
  }

  if (mcpServerId) {
    const { data, error } = await db
      .from("agent_mcps")
      .select("agent_id")
      .eq("mcp_server_id", mcpServerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ agent_ids: (data ?? []).map((r) => r.agent_id) });
  }

  return NextResponse.json({ error: "agent_id or mcp_server_id required" }, { status: 400 });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { agent_id, mcp_server_ids, mcp_server_id, agent_ids } = body;
  const db = await createAdminClient();

  if (agent_id && Array.isArray(mcp_server_ids)) {
    await db.from("agent_mcps").delete().eq("agent_id", agent_id);
    if (mcp_server_ids.length > 0) {
      const rows = mcp_server_ids.map((mid: string) => ({ agent_id, mcp_server_id: mid }));
      const { error } = await db.from("agent_mcps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, mcp_server_ids });
  }

  if (mcp_server_id && Array.isArray(agent_ids)) {
    await db.from("agent_mcps").delete().eq("mcp_server_id", mcp_server_id);
    if (agent_ids.length > 0) {
      const rows = agent_ids.map((aid: string) => ({ agent_id: aid, mcp_server_id }));
      const { error } = await db.from("agent_mcps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, agent_ids });
  }

  return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
}
