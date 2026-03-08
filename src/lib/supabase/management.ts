import { getSecret } from "@/lib/secrets";

const MGMT_BASE = "https://api.supabase.com/v1";

interface MgmtQueryResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function getCredentials() {
  const token = await getSecret("SUPABASE_ACCESS_TOKEN");
  const ref = await getSecret("SUPABASE_PROJECT_REF");
  if (!token || !ref) {
    throw new Error(
      "Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in secrets"
    );
  }
  return { token, ref };
}

export async function executeSQL(query: string): Promise<MgmtQueryResult> {
  const { token, ref } = await getCredentials();

  const res = await fetch(`${MGMT_BASE}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  }

  const data = await res.json();
  return { success: true, data };
}

/**
 * Run a migration SQL file against the project database.
 * Wraps the SQL in a transaction for atomicity.
 */
export async function runMigration(sql: string): Promise<MgmtQueryResult> {
  const wrapped = `BEGIN;\n${sql}\nCOMMIT;`;
  return executeSQL(wrapped);
}

export async function listExtensions(): Promise<MgmtQueryResult> {
  return executeSQL(
    "SELECT name, installed_version, default_version, comment FROM pg_available_extensions WHERE installed_version IS NOT NULL ORDER BY name;"
  );
}

export async function enableExtension(
  name: string,
  schema = "extensions"
): Promise<MgmtQueryResult> {
  return executeSQL(
    `CREATE EXTENSION IF NOT EXISTS "${name}" WITH SCHEMA ${schema};`
  );
}

// ─── pg_cron helpers ───

const JOB_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CRON_EXPR_RE = /^[0-9*,/\- ]+$/;

function validateJobName(name: string) {
  if (!JOB_NAME_RE.test(name)) {
    throw new Error(
      `Invalid job name "${name}". Must match ${JOB_NAME_RE.source}`
    );
  }
}

function validateCronExpr(expr: string) {
  if (!CRON_EXPR_RE.test(expr)) {
    throw new Error(
      `Invalid cron expression "${expr}". Only digits, *, /, -, comma and spaces allowed.`
    );
  }
}

function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}

export async function listCronJobs(): Promise<MgmtQueryResult> {
  return executeSQL(
    "SELECT jobid, jobname, schedule, nodename, active FROM cron.job ORDER BY jobid;"
  );
}

export async function scheduleCronJob(
  jobName: string,
  schedule: string,
  command: string
): Promise<MgmtQueryResult> {
  validateJobName(jobName);
  validateCronExpr(schedule);
  return executeSQL(
    `SELECT cron.schedule('${escapeSQL(jobName)}', '${escapeSQL(schedule)}', '${escapeSQL(command)}');`
  );
}

export async function unscheduleCronJob(
  jobName: string
): Promise<MgmtQueryResult> {
  validateJobName(jobName);
  return executeSQL(`SELECT cron.unschedule('${escapeSQL(jobName)}');`);
}

export async function getCronJobHistory(
  limit = 20
): Promise<MgmtQueryResult> {
  return executeSQL(
    `SELECT jobid, job_pid, status, return_message, start_time, end_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT ${limit};`
  );
}

// ─── pg_net check ───

export async function ensurePgNetEnabled(): Promise<MgmtQueryResult> {
  return enableExtension("pg_net");
}

/**
 * Schedule a reminder: creates a pg_cron job that fires pg_net.http_post
 * to our /api/worker/remind endpoint.
 */
export async function scheduleReminder(opts: {
  jobName: string;
  cronExpr: string;
  agentId: string;
  chatId: number;
  message: string;
  appUrl: string;
  cronSecret: string;
}): Promise<MgmtQueryResult> {
  const body = JSON.stringify({
    agent_id: opts.agentId,
    chat_id: opts.chatId,
    message: opts.message,
  }).replace(/'/g, "''");

  const command = `SELECT net.http_post(
    url := '${opts.appUrl}/api/worker/remind',
    headers := '{"Content-Type":"application/json","x-cron-secret":"${opts.cronSecret}"}'::jsonb,
    body := '${body}'::jsonb
  )`;

  return scheduleCronJob(opts.jobName, opts.cronExpr, command);
}
