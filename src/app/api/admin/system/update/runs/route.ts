import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  createAdminClient,
  requireAdmin,
} from "@/lib/supabase/server";
import { listUpdateRuns } from "@/lib/system-update/service";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)),
  );

  try {
    const db = await createAdminClient();
    const runs = await listUpdateRuns(db, limit);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load update runs" },
      { status: 500 },
    );
  }
}
