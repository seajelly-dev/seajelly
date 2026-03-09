import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") ?? "20", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const agentName = searchParams.get("agent_name")?.trim() || null;
  const channelName = searchParams.get("channel_name")?.trim() || null;
  const scope = searchParams.get("scope") || null;

  let agentIds: string[] | null = null;
  if (agentName) {
    const { data: agents } = await db
      .from("agents")
      .select("id")
      .ilike("name", `%${agentName}%`);
    agentIds = (agents ?? []).map((a) => a.id);
    if (agentIds.length === 0) {
      return NextResponse.json({ memories: [], total: 0 });
    }
  }

  let channelIds: string[] | null = null;
  if (channelName) {
    const { data: channels } = await db
      .from("channels")
      .select("id")
      .ilike("display_name", `%${channelName}%`);
    channelIds = (channels ?? []).map((c) => c.id);
    if (channelIds.length === 0) {
      return NextResponse.json({ memories: [], total: 0 });
    }
  }

  let countQuery = db.from("memories").select("id", { count: "exact", head: true });
  if (agentIds) countQuery = countQuery.in("agent_id", agentIds);
  if (channelIds) countQuery = countQuery.in("channel_id", channelIds);
  if (scope) countQuery = countQuery.eq("scope", scope);
  const { count } = await countQuery;

  let query = db
    .from("memories")
    .select("*, agents:agent_id(name), channels:channel_id(display_name)")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (agentIds) query = query.in("agent_id", agentIds);
  if (channelIds) query = query.in("channel_id", channelIds);
  if (scope) query = query.eq("scope", scope);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memories: data, total: count ?? 0 });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const body = await request.json();
  const { id, content, category } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (content !== undefined) updates.content = content;
  if (category !== undefined) updates.category = category;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.from("memories").update(updates).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await db.from("memories").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
