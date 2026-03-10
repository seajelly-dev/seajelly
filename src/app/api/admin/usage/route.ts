import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "today";

  const now = new Date();
  let since: string;
  if (range === "7d") {
    since = new Date(now.getTime() - 7 * 86400000).toISOString();
  } else if (range === "30d") {
    since = new Date(now.getTime() - 30 * 86400000).toISOString();
  } else {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    since = todayStart.toISOString();
  }

  const { data, error } = await db
    .from("api_usage_logs")
    .select("input_tokens, output_tokens, model_id, provider_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const logs = data ?? [];
  const totalCalls = logs.length;
  const totalInputTokens = logs.reduce((sum, l) => sum + (l.input_tokens || 0), 0);
  const totalOutputTokens = logs.reduce((sum, l) => sum + (l.output_tokens || 0), 0);

  const byModel: Record<string, { calls: number; input_tokens: number; output_tokens: number }> = {};
  const byProvider: Record<string, { calls: number; input_tokens: number; output_tokens: number }> = {};

  for (const log of logs) {
    const mk = log.model_id || "unknown";
    if (!byModel[mk]) byModel[mk] = { calls: 0, input_tokens: 0, output_tokens: 0 };
    byModel[mk].calls++;
    byModel[mk].input_tokens += log.input_tokens || 0;
    byModel[mk].output_tokens += log.output_tokens || 0;

    const pk = log.provider_id || "unknown";
    if (!byProvider[pk]) byProvider[pk] = { calls: 0, input_tokens: 0, output_tokens: 0 };
    byProvider[pk].calls++;
    byProvider[pk].input_tokens += log.input_tokens || 0;
    byProvider[pk].output_tokens += log.output_tokens || 0;
  }

  return NextResponse.json({
    range,
    total_calls: totalCalls,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    by_model: byModel,
    by_provider: byProvider,
  });
}
