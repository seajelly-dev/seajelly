import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { unscheduleCronJob, listCronJobs } from "@/lib/supabase/management";
import { getPgCronJobName } from "@/lib/agent/scheduled-jobs";

const RECONCILE_COOLDOWN_MS = 60_000;
let lastReconcileAt = 0;

async function reconcileLocalStatus(
  db: Awaited<ReturnType<typeof createAdminClient>>
) {
  const liveCron = await listCronJobs();
  if (!liveCron.success || !Array.isArray(liveCron.data)) return;

  const liveNames = new Set<string>();
  for (const row of liveCron.data as Array<Record<string, unknown>>) {
    if (typeof row.jobname === "string") liveNames.add(row.jobname);
  }

  // Avoid racing with newly-created jobs that may still be propagating.
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: localRows, error: localErr } = await db
    .from("cron_jobs")
    .select("id, task_config")
    .eq("enabled", true)
    .lt("created_at", cutoff);
  if (localErr || !localRows?.length) return;

  const staleIds = localRows
    .filter((r) => {
      const jobName = getPgCronJobName(r.task_config);
      return jobName ? !liveNames.has(jobName) : false;
    })
    .map((r) => r.id as string);
  if (!staleIds.length) return;

  await db.from("cron_jobs").update({ enabled: false }).in("id", staleIds);
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("page_size") ?? "20", 10))
  );
  const forceReconcile = searchParams.get("reconcile") === "1";
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const db = await createAdminClient();
  if (forceReconcile) {
    try {
      await reconcileLocalStatus(db);
      lastReconcileAt = Date.now();
    } catch (err) {
      console.warn("Tasks reconcile (forced) failed:", err);
    }
  } else if (Date.now() - lastReconcileAt > RECONCILE_COOLDOWN_MS) {
    lastReconcileAt = Date.now();
    after(async () => {
      try {
        await reconcileLocalStatus(db);
      } catch (err) {
        console.warn("Tasks reconcile (background) failed:", err);
      }
    });
  }

  const { count } = await db
    .from("cron_jobs")
    .select("id", { count: "exact", head: true });

  const { data, error } = await db
    .from("cron_jobs")
    .select("*, agents(name)")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tasks = (data ?? []).map((row) => {
    const agent = row.agents as unknown as { name: string } | null;
    return {
      id: row.id,
      agent_id: row.agent_id,
      agent_name: agent?.name ?? "Unknown",
      schedule: row.schedule,
      task_type: row.task_type,
      task_config: row.task_config,
      enabled: row.enabled,
      last_run: row.last_run,
      created_at: row.created_at,
    };
  });

  return NextResponse.json({ tasks, total: count ?? 0 });
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = await createAdminClient();

  const { data: job, error: fetchErr } = await db
    .from("cron_jobs")
    .select("task_config")
    .eq("id", id)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const config = job.task_config as Record<string, unknown>;
  const displayJobName = config?.job_name as string | undefined;
  const pgCronJobName = getPgCronJobName(config);

  if (pgCronJobName) {
    try {
      await unscheduleCronJob(pgCronJobName);
    } catch (e) {
      console.warn(`Failed to unschedule pg_cron job "${pgCronJobName}":`, e);
    }
  }

  const { error: delErr } = await db.from("cron_jobs").delete().eq("id", id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, unscheduled: displayJobName ?? pgCronJobName ?? null });
}
