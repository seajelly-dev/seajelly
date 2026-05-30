import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CronJob } from "@/types/database";

export interface ScheduledJobScope {
  agentId: string;
  platformChatId: string;
  platform: string;
}

export interface VisibleScheduledJob {
  id: string;
  schedule: string;
  task_type: string;
  task_config: Record<string, unknown>;
  enabled: boolean;
  last_run: string | null;
  created_at: string;
}

export interface OwnedScheduledJob extends VisibleScheduledJob {
  pgCronJobName: string;
}

type CronJobsQueryResult =
  | { success: true; jobs: VisibleScheduledJob[] }
  | { success: false; error: string };

type OwnedJobQueryResult =
  | { success: true; job: OwnedScheduledJob | null }
  | { success: false; error: string };

export function getTaskJobName(taskConfig: unknown): string | null {
  if (!taskConfig || typeof taskConfig !== "object") return null;
  const raw = (taskConfig as Record<string, unknown>).job_name;
  return typeof raw === "string" ? raw : null;
}

export function getPgCronJobName(taskConfig: unknown): string | null {
  if (!taskConfig || typeof taskConfig !== "object") return null;
  const config = taskConfig as Record<string, unknown>;
  const scoped = config.pg_cron_job_name;
  if (typeof scoped === "string" && scoped.length > 0) return scoped;
  return getTaskJobName(taskConfig);
}

function matchesScope(row: Pick<CronJob, "agent_id" | "task_config">, scope: ScheduledJobScope): boolean {
  const config = row.task_config;
  return (
    row.agent_id === scope.agentId &&
    String(config.chat_id ?? "") === scope.platformChatId &&
    config.platform === scope.platform
  );
}

function sanitizeTaskConfig(taskConfig: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of ["job_name", "message", "prompt", "once"] as const) {
    if (taskConfig[key] !== undefined) sanitized[key] = taskConfig[key];
  }
  return sanitized;
}

function toVisibleScheduledJob(row: CronJob): VisibleScheduledJob {
  return {
    id: row.id,
    schedule: row.schedule,
    task_type: row.task_type,
    task_config: sanitizeTaskConfig(row.task_config),
    enabled: row.enabled,
    last_run: row.last_run,
    created_at: row.created_at,
  };
}

async function listRowsForScope(
  supabase: SupabaseClient,
  scope: ScheduledJobScope,
  jobName?: string,
): Promise<{ data: CronJob[]; error: string | null }> {
  let query = supabase
    .from("cron_jobs")
    .select("id, agent_id, schedule, task_type, task_config, enabled, last_run, created_at")
    .eq("agent_id", scope.agentId)
    .eq("enabled", true)
    .eq("task_config->>chat_id", scope.platformChatId)
    .eq("task_config->>platform", scope.platform);

  if (jobName) {
    query = query.eq("task_config->>job_name", jobName);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };

  const rows = ((data ?? []) as CronJob[]).filter((row) => {
    if (!matchesScope(row, scope)) return false;
    return jobName ? getTaskJobName(row.task_config) === jobName : true;
  });
  return { data: rows, error: null };
}

export async function listScheduledJobsForScope(
  supabase: SupabaseClient,
  scope: ScheduledJobScope,
): Promise<CronJobsQueryResult> {
  const { data, error } = await listRowsForScope(supabase, scope);
  if (error) return { success: false, error };
  return { success: true, jobs: data.map(toVisibleScheduledJob) };
}

export async function findOwnedScheduledJobByName(
  supabase: SupabaseClient,
  scope: ScheduledJobScope,
  jobName: string,
): Promise<OwnedJobQueryResult> {
  const { data, error } = await listRowsForScope(supabase, scope, jobName);
  if (error) return { success: false, error };
  const row = data[0];
  if (!row) return { success: true, job: null };

  const pgCronJobName = getPgCronJobName(row.task_config);
  if (!pgCronJobName) return { success: true, job: null };

  return {
    success: true,
    job: {
      ...toVisibleScheduledJob(row),
      pgCronJobName,
    },
  };
}

export async function disableOwnedLocalCronJobs(
  supabase: SupabaseClient,
  scope: ScheduledJobScope,
  jobName: string,
  opts: { markLastRun?: boolean } = {},
): Promise<{ updated: number; error?: string }> {
  const { data, error } = await listRowsForScope(supabase, scope, jobName);
  if (error) return { updated: 0, error };

  const ids = data.map((row) => row.id);
  if (ids.length === 0) return { updated: 0 };

  const patch: Record<string, unknown> = { enabled: false };
  if (opts.markLastRun) patch.last_run = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("cron_jobs")
    .update(patch)
    .in("id", ids);

  if (updateErr) return { updated: 0, error: updateErr.message };
  return { updated: ids.length };
}

export function buildScopedCronJobName(scope: ScheduledJobScope, jobName: string): string {
  const hash = createHash("sha256")
    .update(`${scope.agentId}:${scope.platform}:${scope.platformChatId}:${jobName}`)
    .digest("hex")
    .slice(0, 12);
  const suffix = jobName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/g, "")
    .slice(0, 48) || "task";

  return `sj-${hash}-${suffix}`.slice(0, 64).replace(/[-_]+$/g, "");
}
