import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  createAdminClient,
  requireAdmin,
} from "@/lib/supabase/server";
import {
  applyDatabaseUpdate,
  getUpdateSystemState,
  initializeUpdateBaseline,
  rollbackUpdate,
  startUpdate,
} from "@/lib/system-update/service";

type UpdateAction =
  | "check"
  | "initialize_baseline"
  | "start"
  | "apply_db"
  | "rollback";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  try {
    const db = await createAdminClient();
    const state = await getUpdateSystemState(db);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load update state" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: UpdateAction;
    runId?: string;
  };

  const db = await createAdminClient();

  try {
    switch (body.action) {
      case "check": {
        const state = await getUpdateSystemState(db);
        return NextResponse.json(state);
      }
      case "initialize_baseline": {
        const settings = await initializeUpdateBaseline(db);
        const state = await getUpdateSystemState(db);
        return NextResponse.json({ success: true, settings, state });
      }
      case "start": {
        const result = await startUpdate(db, user.id);
        return NextResponse.json({
          success: true,
          run: result.run,
          latestRelease: result.latestRelease,
          manifest: result.manifest,
        });
      }
      case "apply_db": {
        if (!body.runId) {
          return NextResponse.json({ error: "runId is required" }, { status: 400 });
        }
        const run = await applyDatabaseUpdate(db, body.runId);
        return NextResponse.json({ success: true, run });
      }
      case "rollback": {
        if (!body.runId) {
          return NextResponse.json({ error: "runId is required" }, { status: 400 });
        }
        const run = await rollbackUpdate(db, body.runId);
        return NextResponse.json({ success: true, run });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Updater action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
