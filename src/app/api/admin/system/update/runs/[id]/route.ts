import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  createAdminClient,
  requireAdmin,
} from "@/lib/supabase/server";
import {
  getUpdateRunById,
  refreshUpdateRun,
} from "@/lib/system-update/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { id } = await context.params;

  try {
    const db = await createAdminClient();
    const current = await getUpdateRunById(db, id);
    if (!current) {
      return NextResponse.json({ error: "Update run not found" }, { status: 404 });
    }
    const run = await refreshUpdateRun(db, id);
    return NextResponse.json({ run: run ?? current });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load update run" },
      { status: 500 },
    );
  }
}
