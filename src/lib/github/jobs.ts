import { createClient } from "@supabase/supabase-js";
import { checkBuildStatus, getE2BApiKey } from "@/lib/e2b/sandbox";

export type GithubBuildJobStatus = "pending" | "building" | "success" | "failed" | "expired";

export interface GithubBuildJob {
  id: string;
  agent_id: string;
  channel_id: string | null;
  requester_uid: string | null;
  trace_id: string | null;
  sandbox_id: string | null;
  status: GithubBuildJobStatus;
  phase: string | null;
  last_log: string | null;
  preview_url: string | null;
  files_hash: string;
  port: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  error_code: string | null;
}

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function parseMetadata(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export interface CreateGithubBuildJobParams {
  agentId: string;
  channelId?: string | null;
  requesterUid?: string | null;
  traceId?: string | null;
  filesHash: string;
  port?: number;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createGithubBuildJob(
  params: CreateGithubBuildJobParams,
): Promise<GithubBuildJob> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("github_build_jobs")
    .insert({
      agent_id: params.agentId,
      channel_id: params.channelId ?? null,
      requester_uid: params.requesterUid ?? null,
      trace_id: params.traceId ?? null,
      files_hash: params.filesHash,
      port: params.port ?? 3000,
      expires_at: params.expiresAt ?? null,
      metadata: params.metadata ?? {},
      status: "pending",
      phase: "queued",
      last_log: "Build job created",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create github build job");
  }
  return { ...data, metadata: parseMetadata(data.metadata) } as GithubBuildJob;
}

export async function getGithubBuildJob(jobId: string): Promise<GithubBuildJob | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("github_build_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) return null;
  return { ...data, metadata: parseMetadata(data.metadata) } as GithubBuildJob;
}

export async function updateGithubBuildJob(
  jobId: string,
  patch: Partial<GithubBuildJob> & Record<string, unknown>,
): Promise<GithubBuildJob> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("github_build_jobs")
    .update(patch)
    .eq("id", jobId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update github build job");
  }
  return { ...data, metadata: parseMetadata(data.metadata) } as GithubBuildJob;
}

export async function listActiveGithubBuildJobs(limit = 10): Promise<GithubBuildJob[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("github_build_jobs")
    .select("*")
    .in("status", ["pending", "building"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({ ...row, metadata: parseMetadata(row.metadata) } as GithubBuildJob));
}

export async function expireStaleGithubBuildJobs(): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("github_build_jobs")
    .update({
      status: "expired",
      phase: "expired",
      error_code: "job_expired",
      finished_at: now,
      last_log: "Job expired before completion",
    })
    .in("status", ["pending", "building"])
    .lt("expires_at", now)
    .select("id");
  if (error || !data) return 0;
  return data.length;
}

export async function syncGithubBuildJobStatus(jobId: string): Promise<GithubBuildJob | null> {
  const job = await getGithubBuildJob(jobId);
  if (!job) return null;
  if (!["pending", "building"].includes(job.status)) return job;

  if (job.expires_at && Date.now() > Date.parse(job.expires_at)) {
    return await updateGithubBuildJob(job.id, {
      status: "expired",
      phase: "expired",
      error_code: "job_expired",
      finished_at: new Date().toISOString(),
      last_log: "Job expired before completion",
    });
  }

  if (!job.sandbox_id) {
    return await updateGithubBuildJob(job.id, {
      status: "failed",
      phase: job.phase ?? "queued",
      error_code: "sandbox_missing",
      finished_at: new Date().toISOString(),
      last_log: "Sandbox id missing on active job",
    });
  }

  const apiKey = await getE2BApiKey();
  if (!apiKey) {
    return await updateGithubBuildJob(job.id, {
      status: "failed",
      phase: "connect",
      error_code: "e2b_api_key_missing",
      finished_at: new Date().toISOString(),
      last_log: "E2B_API_KEY not configured",
    });
  }

  const status = await checkBuildStatus(apiKey, job.sandbox_id, job.port ?? 3000);
  if (status.status === "building") {
    return await updateGithubBuildJob(job.id, {
      status: "building",
      phase: status.phase ?? "building",
      last_log: status.log ?? "Build in progress",
      error_code: null,
    });
  }

  if (status.status === "success") {
    return await updateGithubBuildJob(job.id, {
      status: "success",
      phase: status.phase ?? "complete",
      last_log: status.log ?? "Build succeeded",
      preview_url: status.previewUrl ?? null,
      error_code: null,
      finished_at: new Date().toISOString(),
    });
  }

  return await updateGithubBuildJob(job.id, {
    status: "failed",
    phase: status.phase ?? "failed",
    last_log: status.log ?? "Build failed",
    error_code: status.errorCode ?? "build_failed",
    finished_at: new Date().toISOString(),
  });
}

export async function cleanupExpiredStepLogs(limit = 500): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data: expiredRows, error: selectErr } = await supabase
    .from("agent_step_logs")
    .select("id")
    .lt("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(limit);
  if (selectErr || !expiredRows || expiredRows.length === 0) return 0;

  const ids = expiredRows.map((row) => row.id);
  const { error: deleteErr } = await supabase
    .from("agent_step_logs")
    .delete()
    .in("id", ids);
  if (deleteErr) return 0;
  return ids.length;
}
