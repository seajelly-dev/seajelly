import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const hours = Math.min(168, Math.max(1, parseInt(searchParams.get("hours") || "24", 10)));

  const { data, error } = await db.rpc("hourly_usage_stats", { hours_back: hours });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
