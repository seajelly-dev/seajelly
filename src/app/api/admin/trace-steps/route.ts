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
  const traceId = searchParams.get("trace_id");
  if (!traceId) {
    return NextResponse.json({ error: "trace_id is required" }, { status: 400 });
  }

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") ?? "50", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const toolName = searchParams.get("tool_name");
  const status = searchParams.get("status");
  const hasError = searchParams.get("has_error");
  const minLatency = Number.parseInt(searchParams.get("min_latency_ms") ?? "", 10);
  const maxLatency = Number.parseInt(searchParams.get("max_latency_ms") ?? "", 10);

  let query = db
    .from("agent_step_logs")
    .select(
      "id, trace_id, event_id, agent_id, channel_id, session_id, step_no, phase, tool_name, tool_input_json, tool_output_json, model_text, status, error_message, latency_ms, created_at, expires_at",
      { count: "exact" },
    )
    .eq("trace_id", traceId);

  if (toolName) query = query.ilike("tool_name", `%${toolName}%`);
  if (status && status !== "all") query = query.eq("status", status);
  if (hasError === "true") query = query.not("error_message", "is", null);
  if (hasError === "false") query = query.is("error_message", null);
  if (Number.isFinite(minLatency)) query = query.gte("latency_ms", minLatency);
  if (Number.isFinite(maxLatency)) query = query.lte("latency_ms", maxLatency);

  const { data, error, count } = await query
    .order("step_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    steps: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}
