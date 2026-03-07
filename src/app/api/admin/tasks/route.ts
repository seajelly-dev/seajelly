import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { unscheduleCronJob } from "@/lib/supabase/management";

async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("cron_jobs")
    .select("*, agents(name)")
    .order("created_at", { ascending: false });

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

  return NextResponse.json({ tasks });
}

export async function DELETE(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const jobName = config?.job_name as string | undefined;

  if (jobName) {
    try {
      await unscheduleCronJob(jobName);
    } catch (e) {
      console.warn(`Failed to unschedule pg_cron job "${jobName}":`, e);
    }
  }

  const { error: delErr } = await db.from("cron_jobs").delete().eq("id", id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, unscheduled: jobName ?? null });
}
