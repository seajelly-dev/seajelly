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
  const id = searchParams.get("id");

  const selectFields =
    "id, platform_chat_id, agent_id, channel_id, version, is_active, updated_at, messages, agents(name), channels:channel_id(platform, display_name)";

  if (id) {
    const { data, error } = await db
      .from("sessions")
      .select(selectFields)
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ session: data });
  }

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("page_size") ?? "20", 10))
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { count } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true });

  const { data, error } = await db
    .from("sessions")
    .select(selectFields)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data, total: count ?? 0 });
}
