import { z } from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/secrets";
import { getRuntimeVersionInfo } from "@/lib/runtime-version";
import {
  applyPatchesToGitHub,
  type PatchOperation,
} from "@/lib/github/patch-harness";
import {
  checkVercelDeployment,
  getBranchHeadSha,
  getFile,
  getRepoInfo,
  revertCommit,
} from "@/lib/github/api";
import { parseRepo } from "@/lib/github/config";
import { runMigration } from "@/lib/supabase/management";
import type {
  UpdateManifest,
  UpdateRunRecord,
  UpgradePathStep,
  UpstreamReleaseSummary,
  UpdateRunStatus,
} from "./types";

const MANIFEST_PATH = ".seajelly/upgrade-manifest.json";
export const DEFAULT_UPSTREAM_REPO = "seajelly-dev/seajelly";

export const UPDATE_SETTING_KEYS = {
  upstreamRepo: "upstream_repo",
  installMode: "install_mode",
  githubDefaultBranch: "github_default_branch",
  installedReleaseTag: "installed_release_tag",
  installedCommitSha: "installed_commit_sha",
  lastCheckedReleaseTag: "last_checked_release_tag",
  lastCheckedAt: "last_checked_at",
  lastUpdateStatus: "last_update_status",
} as const;

const TERMINAL_UPDATE_STATUSES = new Set<UpdateRunStatus>([
  "blocked",
  "success",
  "deploy_error",
  "rolled_back",
  "failed",
]);

const updateManifestPatchSchema = z.object({
  type: z.enum(["create_file", "update_file", "delete_file"]),
  path: z.string().min(1),
  diff: z.string().optional(),
  expected_blob_sha: z.string().optional(),
}).superRefine((value, ctx) => {
  if ((value.type === "create_file" || value.type === "update_file") && !value.diff) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} requires diff`,
      path: ["diff"],
    });
  }
  if ((value.type === "update_file" || value.type === "delete_file") && !value.expected_blob_sha) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} requires expected_blob_sha`,
      path: ["expected_blob_sha"],
    });
  }
});

const updateManifestSchema = z.object({
  manifest_version: z.literal(1),
  release_tag: z.string().min(1),
  release_commit_sha: z.string().min(1),
  previous_supported_tag: z.string().min(1),
  requires_manual_review: z.boolean().optional(),
  required_env_keys: z.array(z.string().min(1)).optional(),
  commit_message: z.string().min(1),
  patches: z.array(updateManifestPatchSchema),
  db: z.object({
    mode: z.enum(["none", "manual_apply"]),
    destructive: z.boolean(),
    sql_path: z.string().min(1).optional(),
    summary: z.string().optional(),
  }).superRefine((value, ctx) => {
    if (value.mode === "manual_apply" && !value.sql_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "manual_apply requires sql_path",
        path: ["sql_path"],
      });
    }
  }),
  notes_md: z.string().optional(),
});

type DbClient = SupabaseClient;

export interface UpdateSystemState {
  upstreamRepo: string;
  installMode: string;
  githubRepo: string;
  githubDefaultBranch: string;
  runtimeVersion: ReturnType<typeof getRuntimeVersionInfo>;
  installedReleaseTag: string;
  installedCommitSha: string;
  lastCheckedReleaseTag: string;
  lastCheckedAt: string;
  lastUpdateStatus: string;
  githubConfigured: boolean;
  vercelConfigured: boolean;
  needsBaseline: boolean;
  activeRun: UpdateRunRecord | null;
  latestRun: UpdateRunRecord | null;
  latestRelease: UpstreamReleaseSummary | null;
  latestManifest: UpdateManifest | null;
  nextRelease: UpstreamReleaseSummary | null;
  nextManifest: UpdateManifest | null;
  upgradePath: UpstreamReleaseSummary[];
  upgradeBlockedReason: string | null;
  upgradeAvailable: boolean;
  missingConfig: string[];
}

export interface StartUpdateResult {
  run: UpdateRunRecord;
  targetRelease: UpstreamReleaseSummary;
  manifest: UpdateManifest;
}

function isUpdateRunTerminal(status: string | null | undefined): boolean {
  return status ? TERMINAL_UPDATE_STATUSES.has(status as UpdateRunStatus) : false;
}

async function readSystemSettings(
  db: DbClient,
  keys: string[],
): Promise<Record<string, string>> {
  const { data, error } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", keys);
  if (error) throw new Error(error.message);
  const settings: Record<string, string> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }
  return settings;
}

async function upsertSystemSettings(
  db: DbClient,
  entries: Record<string, string>,
): Promise<void> {
  const payload = Object.entries(entries).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));
  if (payload.length === 0) return;
  const { error } = await db
    .from("system_settings")
    .upsert(payload, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

async function getConfiguredSecretKeys(
  db: DbClient,
): Promise<Set<string>> {
  const { data, error } = await db
    .from("secrets")
    .select("key_name")
    .in("key_name", ["GITHUB_TOKEN", "VERCEL_TOKEN", "VERCEL_PROJECT_ID"]);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.key_name));
}

async function getAdminRecordId(
  db: DbClient,
  authUid: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("admins")
    .select("id")
    .eq("auth_uid", authUid)
    .single();
  if (error || !data) return null;
  return data.id as string;
}

function mapRunRow(row: Record<string, unknown>): UpdateRunRecord {
  return {
    id: String(row.id ?? ""),
    created_by_admin_id:
      typeof row.created_by_admin_id === "string"
        ? row.created_by_admin_id
        : null,
    from_release_tag: String(row.from_release_tag ?? ""),
    to_release_tag: String(row.to_release_tag ?? ""),
    from_commit_sha:
      typeof row.from_commit_sha === "string" ? row.from_commit_sha : null,
    patch_commit_sha:
      typeof row.patch_commit_sha === "string" ? row.patch_commit_sha : null,
    rollback_commit_sha:
      typeof row.rollback_commit_sha === "string" ? row.rollback_commit_sha : null,
    local_repo: String(row.local_repo ?? ""),
    local_branch: String(row.local_branch ?? ""),
    status: String(row.status ?? "failed") as UpdateRunStatus,
    deploy_status:
      typeof row.deploy_status === "string" ? row.deploy_status : null,
    deployment_id:
      typeof row.deployment_id === "string" ? row.deployment_id : null,
    deployment_url:
      typeof row.deployment_url === "string" ? row.deployment_url : null,
    has_db_changes: Boolean(row.has_db_changes),
    db_mode: String(row.db_mode ?? "none"),
    error_summary:
      typeof row.error_summary === "string" ? row.error_summary : null,
    details_json:
      row.details_json && typeof row.details_json === "object"
        ? (row.details_json as Record<string, unknown>)
        : {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function listRunsInternal(
  db: DbClient,
  limit = 20,
): Promise<UpdateRunRecord[]> {
  const { data, error } = await db
    .from("update_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRunRow(row as Record<string, unknown>));
}

export async function listUpdateRuns(
  db: DbClient,
  limit = 20,
): Promise<UpdateRunRecord[]> {
  return listRunsInternal(db, limit);
}

export async function getUpdateRunById(
  db: DbClient,
  id: string,
): Promise<UpdateRunRecord | null> {
  const { data, error } = await db
    .from("update_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return mapRunRow(data as Record<string, unknown>);
}

async function getLatestRuns(
  db: DbClient,
): Promise<{ latestRun: UpdateRunRecord | null; activeRun: UpdateRunRecord | null }> {
  const runs = await listRunsInternal(db, 10);
  return {
    latestRun: runs[0] ?? null,
    activeRun: runs.find((run) => !isUpdateRunTerminal(run.status)) ?? null,
  };
}

async function createUpdateRun(
  db: DbClient,
  payload: Partial<UpdateRunRecord> & {
    created_by_admin_id: string | null;
    from_release_tag: string;
    to_release_tag: string;
    local_repo: string;
    local_branch: string;
    status: UpdateRunStatus;
  },
): Promise<UpdateRunRecord> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("update_runs")
    .insert({
      created_by_admin_id: payload.created_by_admin_id,
      from_release_tag: payload.from_release_tag,
      to_release_tag: payload.to_release_tag,
      from_commit_sha: payload.from_commit_sha ?? null,
      patch_commit_sha: payload.patch_commit_sha ?? null,
      rollback_commit_sha: payload.rollback_commit_sha ?? null,
      local_repo: payload.local_repo,
      local_branch: payload.local_branch,
      status: payload.status,
      deploy_status: payload.deploy_status ?? null,
      deployment_id: payload.deployment_id ?? null,
      deployment_url: payload.deployment_url ?? null,
      has_db_changes: payload.has_db_changes ?? false,
      db_mode: payload.db_mode ?? "none",
      error_summary: payload.error_summary ?? null,
      details_json: payload.details_json ?? {},
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Failed to create update run");
  }
  return mapRunRow(data as Record<string, unknown>);
}

async function updateRun(
  db: DbClient,
  id: string,
  patch: Partial<UpdateRunRecord>,
): Promise<UpdateRunRecord> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(patch)) {
    payload[key] = value;
  }
  const { data, error } = await db
    .from("update_runs")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Failed to update update run");
  }
  return mapRunRow(data as Record<string, unknown>);
}

function buildRawFileUrl(
  repo: string,
  ref: string,
  path: string,
): string {
  const { owner, name } = parseRepo(repo);
  const cleanPath = path.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(ref)}/${cleanPath}`;
}

async function fetchTextOrThrow(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain, application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upstream fetch failed (${response.status}): ${text || url}`);
  }
  return response.text();
}

export async function fetchUpstreamReleases(
  upstreamRepo = DEFAULT_UPSTREAM_REPO,
  limit = 20,
): Promise<UpstreamReleaseSummary[]> {
  const { owner, name } = parseRepo(upstreamRepo);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${name}/releases?per_page=${limit}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch releases (${response.status}): ${text}`);
  }
  const data = (await response.json()) as Array<Record<string, unknown>>;
  return data
    .filter((item) => !item.draft && !item.prerelease && typeof item.tag_name === "string")
    .map((item) => ({
      tag: String(item.tag_name ?? ""),
      name: String(item.name ?? item.tag_name ?? ""),
      body: String(item.body ?? ""),
      publishedAt: String(item.published_at ?? item.created_at ?? ""),
      htmlUrl: String(item.html_url ?? ""),
    }))
    .filter((item) => item.tag)
    .sort((a, b) => sortReleasesByPublishedAtAscending(b, a));
}

export async function fetchLatestUpstreamRelease(
  upstreamRepo = DEFAULT_UPSTREAM_REPO,
): Promise<UpstreamReleaseSummary> {
  const releases = await fetchUpstreamReleases(upstreamRepo, 1);
  if (!releases[0]) {
    throw new Error("No upstream releases found");
  }
  return releases[0];
}

export async function fetchUpdateManifest(
  upstreamRepo: string,
  tag: string,
): Promise<UpdateManifest> {
  const text = await fetchTextOrThrow(buildRawFileUrl(upstreamRepo, tag, MANIFEST_PATH));
  const parsed = JSON.parse(text) as unknown;
  const manifest = updateManifestSchema.parse(parsed);
  if (manifest.release_tag !== tag) {
    throw new Error(
      `Manifest release_tag mismatch. Expected ${tag}, got ${manifest.release_tag}`,
    );
  }
  return manifest;
}

async function fetchDbSql(
  upstreamRepo: string,
  tag: string,
  sqlPath: string,
): Promise<string> {
  return fetchTextOrThrow(buildRawFileUrl(upstreamRepo, tag, sqlPath));
}

async function fetchReleaseManifests(
  upstreamRepo: string,
  releases: UpstreamReleaseSummary[],
): Promise<Map<string, UpdateManifest>> {
  const entries = await Promise.all(
    releases.map(async (release) => {
      try {
        const manifest = await fetchUpdateManifest(upstreamRepo, release.tag);
        return [release.tag, manifest] as const;
      } catch {
        return null;
      }
    }),
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, UpdateManifest] => Boolean(entry)),
  );
}

function sortReleasesByPublishedAtAscending(
  a: UpstreamReleaseSummary,
  b: UpstreamReleaseSummary,
) {
  const aTime = Date.parse(a.publishedAt || "");
  const bTime = Date.parse(b.publishedAt || "");
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
    return aTime - bTime;
  }
  return a.tag.localeCompare(b.tag);
}

function buildUpgradePath(
  installedReleaseTag: string,
  releases: UpstreamReleaseSummary[],
  manifestMap: Map<string, UpdateManifest>,
): {
  path: UpgradePathStep[];
  blockedReason: string | null;
} {
  const latestRelease = releases[0] ?? null;
  if (!installedReleaseTag || !latestRelease || latestRelease.tag === installedReleaseTag) {
    return { path: [], blockedReason: null };
  }

  const path: UpgradePathStep[] = [];
  const visitedTags = new Set<string>([installedReleaseTag]);
  let currentTag = installedReleaseTag;

  while (path.length < releases.length) {
    const candidates = releases
      .map((release) => {
        const manifest = manifestMap.get(release.tag);
        return manifest ? { release, manifest } : null;
      })
      .filter((item): item is UpgradePathStep => item !== null)
      .filter(
        (item) =>
          item.manifest.previous_supported_tag === currentTag &&
          !visitedTags.has(item.release.tag),
      )
      .sort((a, b) => sortReleasesByPublishedAtAscending(a.release, b.release));

    if (!candidates[0]) break;

    const nextStep = candidates[0];
    path.push(nextStep);
    visitedTags.add(nextStep.release.tag);
    currentTag = nextStep.release.tag;
  }

  if (path.length === 0) {
    return {
      path,
      blockedReason: `No official upgrade path was found from ${installedReleaseTag} to ${latestRelease.tag}.`,
    };
  }

  const lastStep = path[path.length - 1];
  if (lastStep.release.tag !== latestRelease.tag) {
    return {
      path,
      blockedReason: `An official upgrade path exists from ${installedReleaseTag}, but it currently stops at ${lastStep.release.tag} before reaching ${latestRelease.tag}.`,
    };
  }

  return { path, blockedReason: null };
}

async function getGitHubRepoState(db: DbClient): Promise<{
  repo: string;
  defaultBranch: string;
  token: string;
}> {
  const settings = await readSystemSettings(db, [
    "github_repo",
    UPDATE_SETTING_KEYS.githubDefaultBranch,
  ]);
  const token = await getSecret("GITHUB_TOKEN", { bypassCache: true });
  const repo = settings.github_repo?.trim() ?? "";
  let defaultBranch = settings[UPDATE_SETTING_KEYS.githubDefaultBranch]?.trim() ?? "";

  if (!token || !repo) {
    throw new Error("GITHUB_TOKEN or github_repo is not configured");
  }

  if (!defaultBranch) {
    const repoInfo = await getRepoInfo(token, repo);
    if (!repoInfo.canPush) {
      throw new Error("GitHub token does not have push permission for the configured repository");
    }
    defaultBranch = repoInfo.defaultBranch;
    await upsertSystemSettings(db, {
      [UPDATE_SETTING_KEYS.githubDefaultBranch]: defaultBranch,
    });
  }

  return { repo, defaultBranch, token };
}

async function getVercelConfig(): Promise<{
  token: string;
  projectId: string;
}> {
  const token = await getSecret("VERCEL_TOKEN", { bypassCache: true });
  const projectId = await getSecret("VERCEL_PROJECT_ID", { bypassCache: true });
  if (!token || !projectId) {
    throw new Error("VERCEL_TOKEN or VERCEL_PROJECT_ID is not configured");
  }
  return { token, projectId };
}

function collectMissingRuntimeEnv(requiredEnvKeys: string[]): string[] {
  return requiredEnvKeys.filter((key) => !process.env[key]?.trim());
}

async function validateManifestAgainstRepo(opts: {
  token: string;
  repo: string;
  branch: string;
  manifest: UpdateManifest;
}): Promise<{ blockedFiles: string[] }> {
  const blockedFiles: string[] = [];

  for (const patch of opts.manifest.patches) {
    if (patch.type === "create_file") {
      try {
        await getFile(opts.token, opts.repo, patch.path, opts.branch);
        blockedFiles.push(patch.path);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!message.includes("GitHub getFile failed (404)")) {
          throw err;
        }
      }
      continue;
    }

    try {
      const current = await getFile(opts.token, opts.repo, patch.path, opts.branch);
      if (patch.expected_blob_sha && current.sha !== patch.expected_blob_sha) {
        blockedFiles.push(patch.path);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("GitHub getFile failed (404)")) {
        blockedFiles.push(patch.path);
        continue;
      }
      throw err;
    }
  }

  return { blockedFiles };
}

async function finalizeSuccessfulRun(
  db: DbClient,
  run: UpdateRunRecord,
): Promise<UpdateRunRecord> {
  await upsertSystemSettings(db, {
    [UPDATE_SETTING_KEYS.installedReleaseTag]: run.to_release_tag,
    [UPDATE_SETTING_KEYS.installedCommitSha]:
      run.patch_commit_sha ?? run.from_commit_sha ?? "",
    [UPDATE_SETTING_KEYS.lastUpdateStatus]: "success",
  });
  return updateRun(db, run.id, {
    status: "success",
    error_summary: null,
  });
}

export async function getUpdateSystemState(
  db: DbClient,
): Promise<UpdateSystemState> {
  const runtimeVersion = getRuntimeVersionInfo();
  const settings = await readSystemSettings(db, [
    UPDATE_SETTING_KEYS.upstreamRepo,
    UPDATE_SETTING_KEYS.installMode,
    UPDATE_SETTING_KEYS.githubDefaultBranch,
    UPDATE_SETTING_KEYS.installedReleaseTag,
    UPDATE_SETTING_KEYS.installedCommitSha,
    UPDATE_SETTING_KEYS.lastCheckedReleaseTag,
    UPDATE_SETTING_KEYS.lastCheckedAt,
    UPDATE_SETTING_KEYS.lastUpdateStatus,
    "github_repo",
  ]);
  const configuredSecretKeys = await getConfiguredSecretKeys(db);
  const { latestRun, activeRun } = await getLatestRuns(db);
  const upstreamRepo =
    settings[UPDATE_SETTING_KEYS.upstreamRepo]?.trim() || DEFAULT_UPSTREAM_REPO;
  const installedReleaseTag =
    settings[UPDATE_SETTING_KEYS.installedReleaseTag]?.trim() ?? "";

  let latestRelease: UpstreamReleaseSummary | null = null;
  let latestManifest: UpdateManifest | null = null;
  let nextRelease: UpstreamReleaseSummary | null = null;
  let nextManifest: UpdateManifest | null = null;
  let upgradePath: UpstreamReleaseSummary[] = [];
  let upgradeBlockedReason: string | null = null;
  try {
    const releases = await fetchUpstreamReleases(upstreamRepo);
    latestRelease = releases[0] ?? null;
    const manifestMap = await fetchReleaseManifests(upstreamRepo, releases);
    latestManifest = latestRelease ? (manifestMap.get(latestRelease.tag) ?? null) : null;
    const pathResult = buildUpgradePath(installedReleaseTag, releases, manifestMap);
    upgradePath = pathResult.path.map((step) => step.release);
    upgradeBlockedReason = pathResult.blockedReason;
    nextRelease = pathResult.path[0]?.release ?? null;
    nextManifest = pathResult.path[0]?.manifest ?? null;
    await upsertSystemSettings(db, {
      [UPDATE_SETTING_KEYS.upstreamRepo]: upstreamRepo,
      [UPDATE_SETTING_KEYS.lastCheckedReleaseTag]: latestRelease?.tag ?? "",
      [UPDATE_SETTING_KEYS.lastCheckedAt]: new Date().toISOString(),
    });
  } catch {
    latestRelease = null;
    latestManifest = null;
    nextRelease = null;
    nextManifest = null;
    upgradePath = [];
    upgradeBlockedReason = null;
  }

  const githubConfigured =
    configuredSecretKeys.has("GITHUB_TOKEN") &&
    Boolean(settings.github_repo?.trim());
  const vercelConfigured =
    configuredSecretKeys.has("VERCEL_TOKEN") &&
    configuredSecretKeys.has("VERCEL_PROJECT_ID");

  const upgradeAvailable = Boolean(
    nextRelease &&
      nextManifest &&
      installedReleaseTag &&
      nextRelease.tag !== installedReleaseTag,
  );

  const missingConfig: string[] = [];
  if (!githubConfigured) {
    if (!configuredSecretKeys.has("GITHUB_TOKEN")) missingConfig.push("GITHUB_TOKEN");
    if (!settings.github_repo?.trim()) missingConfig.push("github_repo");
  }
  if (!vercelConfigured) {
    if (!configuredSecretKeys.has("VERCEL_TOKEN")) missingConfig.push("VERCEL_TOKEN");
    if (!configuredSecretKeys.has("VERCEL_PROJECT_ID")) missingConfig.push("VERCEL_PROJECT_ID");
  }

  return {
    upstreamRepo,
    installMode: settings[UPDATE_SETTING_KEYS.installMode]?.trim() || "vercel_clone",
    githubRepo: settings.github_repo?.trim() || "",
    githubDefaultBranch: settings[UPDATE_SETTING_KEYS.githubDefaultBranch]?.trim() || "",
    runtimeVersion,
    installedReleaseTag,
    installedCommitSha:
      settings[UPDATE_SETTING_KEYS.installedCommitSha]?.trim() || runtimeVersion.commitSha,
    lastCheckedReleaseTag:
      settings[UPDATE_SETTING_KEYS.lastCheckedReleaseTag]?.trim() || "",
    lastCheckedAt: settings[UPDATE_SETTING_KEYS.lastCheckedAt]?.trim() || "",
    lastUpdateStatus: settings[UPDATE_SETTING_KEYS.lastUpdateStatus]?.trim() || "idle",
    githubConfigured,
    vercelConfigured,
    needsBaseline: !installedReleaseTag,
    activeRun,
    latestRun,
    latestRelease,
    latestManifest,
    nextRelease,
    nextManifest,
    upgradePath,
    upgradeBlockedReason,
    upgradeAvailable,
    missingConfig,
  };
}

export async function initializeUpdateBaseline(
  db: DbClient,
): Promise<Record<string, string>> {
  const runtimeVersion = getRuntimeVersionInfo();
  const settings = await readSystemSettings(db, ["github_repo"]);
  let installedCommitSha = runtimeVersion.commitSha;

  if (!installedCommitSha) {
    try {
      const { token, repo, defaultBranch } = await getGitHubRepoState(db);
      const branchHead = await getBranchHeadSha(token, repo, defaultBranch);
      installedCommitSha = branchHead;
    } catch {
      // fall through — still allow baseline without commit if runtime env is missing
    }
  }

  const payload = {
    [UPDATE_SETTING_KEYS.upstreamRepo]: DEFAULT_UPSTREAM_REPO,
    [UPDATE_SETTING_KEYS.installMode]: "vercel_clone",
    [UPDATE_SETTING_KEYS.installedReleaseTag]: runtimeVersion.releaseTag,
    [UPDATE_SETTING_KEYS.installedCommitSha]: installedCommitSha,
    [UPDATE_SETTING_KEYS.lastUpdateStatus]: "idle",
  };

  if (settings.github_repo?.trim()) {
    payload[UPDATE_SETTING_KEYS.upstreamRepo] = DEFAULT_UPSTREAM_REPO;
  }

  await upsertSystemSettings(db, payload);
  return payload;
}

export async function startUpdate(
  db: DbClient,
  authUid: string,
): Promise<StartUpdateResult> {
  const state = await getUpdateSystemState(db);
  if (state.activeRun) {
    throw new Error("Another update is already in progress");
  }
  if (state.needsBaseline) {
    throw new Error("Initialize the current install as an upgrade baseline first");
  }
  if (!state.githubConfigured || !state.vercelConfigured) {
    throw new Error("GitHub or Vercel configuration is incomplete");
  }
  if (!state.nextRelease || !state.nextManifest) {
    throw new Error(
      state.upgradeBlockedReason || "A supported next-hop release is not available yet",
    );
  }

  const manifest = state.nextManifest;
  const targetRelease = state.nextRelease;
  if (manifest.requires_manual_review) {
    throw new Error("This release requires manual review and is blocked from one-click upgrades");
  }
  if (manifest.db.destructive) {
    throw new Error("This release includes destructive database changes and is blocked from one-click upgrades");
  }
  if (state.installedReleaseTag !== manifest.previous_supported_tag) {
    throw new Error(
      `This install is on ${state.installedReleaseTag}, but the release only supports upgrading from ${manifest.previous_supported_tag}`,
    );
  }

  const missingEnv = collectMissingRuntimeEnv(manifest.required_env_keys ?? []);
  if (missingEnv.length > 0) {
    throw new Error(`Missing required deployment env keys: ${missingEnv.join(", ")}`);
  }

  const { token, repo, defaultBranch } = await getGitHubRepoState(db);
  const { blockedFiles } = await validateManifestAgainstRepo({
    token,
    repo,
    branch: defaultBranch,
    manifest,
  });

  const adminRecordId = await getAdminRecordId(db, authUid);
  const branchHead = await getBranchHeadSha(token, repo, defaultBranch);
  let run = await createUpdateRun(db, {
    created_by_admin_id: adminRecordId,
    from_release_tag: state.installedReleaseTag,
    to_release_tag: targetRelease.tag,
    from_commit_sha: branchHead,
    local_repo: repo,
    local_branch: defaultBranch,
    status: blockedFiles.length > 0 ? "blocked" : "patching",
    has_db_changes: manifest.db.mode !== "none",
    db_mode: manifest.db.mode,
    details_json: {
      latest_release_name: targetRelease.name,
      latest_release_url: targetRelease.htmlUrl,
      latest_release_published_at: targetRelease.publishedAt,
      required_env_keys: manifest.required_env_keys ?? [],
      notes_md: manifest.notes_md ?? targetRelease.body,
      blocked_files: blockedFiles,
      db_summary: manifest.db.summary ?? "",
      remaining_upgrade_tags: state.upgradePath.map((release) => release.tag),
      remaining_upgrade_count: state.upgradePath.length,
    },
    error_summary:
      blockedFiles.length > 0
        ? `Custom code detected in managed files: ${blockedFiles.join(", ")}`
        : null,
  });

  if (blockedFiles.length > 0) {
    await upsertSystemSettings(db, {
      [UPDATE_SETTING_KEYS.lastUpdateStatus]: "blocked",
    });
    return { run, targetRelease, manifest };
  }

  await upsertSystemSettings(db, {
    [UPDATE_SETTING_KEYS.lastUpdateStatus]: "running",
  });

  try {
    const patchOperations: PatchOperation[] = manifest.patches.map((patch) => ({
      type: patch.type,
      path: patch.path,
      diff: patch.diff,
    }));
    const result = await applyPatchesToGitHub(
      token,
      repo,
      patchOperations,
      manifest.commit_message,
      defaultBranch,
    );
    run = await updateRun(db, run.id, {
      patch_commit_sha: result.commitSha,
      status: "deploy_pending",
      details_json: {
        ...run.details_json,
        patched_files: result.patchedFiles,
        commit_url: result.commitUrl,
      },
    });
    return { run, targetRelease, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply update patches";
    run = await updateRun(db, run.id, {
      status: "failed",
      error_summary: message,
    });
    await upsertSystemSettings(db, {
      [UPDATE_SETTING_KEYS.lastUpdateStatus]: "failed",
    });
    throw new Error(message);
  }
}

export async function refreshUpdateRun(
  db: DbClient,
  runId: string,
): Promise<UpdateRunRecord | null> {
  const run = await getUpdateRunById(db, runId);
  if (!run) return null;

  if (run.status === "deploy_pending") {
    if (!run.patch_commit_sha) return run;
    const { token, projectId } = await getVercelConfig();
    const deployment = await checkVercelDeployment(
      token,
      projectId,
      run.patch_commit_sha,
    );
    const nextDetails = {
      ...run.details_json,
      build_logs:
        deployment.state === "ERROR" ? deployment.buildLogs ?? "" : run.details_json.build_logs,
    };
    if (deployment.state === "READY") {
      const readyRun = await updateRun(db, run.id, {
        status: run.has_db_changes && run.db_mode === "manual_apply" ? "db_pending" : "success",
        deploy_status: deployment.state,
        deployment_id: deployment.deploymentId ?? null,
        deployment_url: deployment.url ?? null,
        error_summary: null,
        details_json: nextDetails,
      });
      if (readyRun.status === "success") {
        return finalizeSuccessfulRun(db, readyRun);
      }
      return readyRun;
    }
    if (deployment.state === "ERROR" || deployment.state === "CANCELED") {
      await upsertSystemSettings(db, {
        [UPDATE_SETTING_KEYS.lastUpdateStatus]: "failed",
      });
      return updateRun(db, run.id, {
        status: "deploy_error",
        deploy_status: deployment.state,
        deployment_id: deployment.deploymentId ?? null,
        deployment_url: deployment.url ?? null,
        error_summary: deployment.errorMessage ?? "Deployment failed",
        details_json: nextDetails,
      });
    }
    return updateRun(db, run.id, {
      deploy_status: deployment.state,
      deployment_id: deployment.deploymentId ?? run.deployment_id,
      deployment_url: deployment.url ?? run.deployment_url,
      details_json: nextDetails,
    });
  }

  if (run.status === "rollback_running") {
    if (!run.rollback_commit_sha) return run;
    const { token, projectId } = await getVercelConfig();
    const deployment = await checkVercelDeployment(
      token,
      projectId,
      run.rollback_commit_sha,
    );
    const nextDetails = {
      ...run.details_json,
      rollback_build_logs:
        deployment.state === "ERROR"
          ? deployment.buildLogs ?? ""
          : run.details_json.rollback_build_logs,
    };
    if (deployment.state === "READY") {
      await upsertSystemSettings(db, {
        [UPDATE_SETTING_KEYS.installedReleaseTag]: run.from_release_tag,
        [UPDATE_SETTING_KEYS.installedCommitSha]: run.from_commit_sha ?? "",
        [UPDATE_SETTING_KEYS.lastUpdateStatus]: "rolled_back",
      });
      return updateRun(db, run.id, {
        status: "rolled_back",
        deploy_status: deployment.state,
        deployment_id: deployment.deploymentId ?? null,
        deployment_url: deployment.url ?? null,
        error_summary: null,
        details_json: nextDetails,
      });
    }
    if (deployment.state === "ERROR" || deployment.state === "CANCELED") {
      await upsertSystemSettings(db, {
        [UPDATE_SETTING_KEYS.lastUpdateStatus]: "failed",
      });
      return updateRun(db, run.id, {
        status: "failed",
        deploy_status: deployment.state,
        deployment_id: deployment.deploymentId ?? null,
        deployment_url: deployment.url ?? null,
        error_summary: deployment.errorMessage ?? "Rollback deployment failed",
        details_json: nextDetails,
      });
    }
    return updateRun(db, run.id, {
      deploy_status: deployment.state,
      deployment_id: deployment.deploymentId ?? run.deployment_id,
      deployment_url: deployment.url ?? run.deployment_url,
      details_json: nextDetails,
    });
  }

  return run;
}

export async function applyDatabaseUpdate(
  db: DbClient,
  runId: string,
): Promise<UpdateRunRecord> {
  const run = await getUpdateRunById(db, runId);
  if (!run) throw new Error("Update run not found");
  if (run.status !== "db_pending") {
    throw new Error("Database update is only available after code deploy is ready");
  }

  const upstreamRepo =
    ((await readSystemSettings(db, [UPDATE_SETTING_KEYS.upstreamRepo]))[
      UPDATE_SETTING_KEYS.upstreamRepo
    ]?.trim()) || DEFAULT_UPSTREAM_REPO;
  const manifest = await fetchUpdateManifest(upstreamRepo, run.to_release_tag);

  if (manifest.db.mode !== "manual_apply" || !manifest.db.sql_path) {
    throw new Error("This release does not declare a manual database update");
  }

  await updateRun(db, run.id, {
    status: "db_running",
  });

  const sql = await fetchDbSql(upstreamRepo, run.to_release_tag, manifest.db.sql_path);
  const result = await runMigration(sql);
  if (!result.success) {
    await upsertSystemSettings(db, {
      [UPDATE_SETTING_KEYS.lastUpdateStatus]: "failed",
    });
    return updateRun(db, run.id, {
      status: "failed",
      error_summary: result.error ?? "Database update failed",
      details_json: {
        ...run.details_json,
        db_sql_path: manifest.db.sql_path,
      },
    });
  }

  const successRun = await updateRun(db, run.id, {
    status: "success",
    error_summary: null,
    details_json: {
      ...run.details_json,
      db_sql_path: manifest.db.sql_path,
      db_applied_at: new Date().toISOString(),
    },
  });

  return finalizeSuccessfulRun(db, successRun);
}

export async function rollbackUpdate(
  db: DbClient,
  runId: string,
): Promise<UpdateRunRecord> {
  const run = await getUpdateRunById(db, runId);
  if (!run) throw new Error("Update run not found");
  if (!["success", "deploy_error"].includes(run.status)) {
    throw new Error("Only the latest finished or failed update can be rolled back");
  }
  if (!run.patch_commit_sha) {
    throw new Error("This run does not have a patch commit to revert");
  }

  const runs = await listRunsInternal(db, 1);
  if (!runs[0] || runs[0].id !== run.id) {
    throw new Error("Only the most recent update run can be rolled back");
  }

  const { token, repo, defaultBranch } = await getGitHubRepoState(db);
  const currentHead = await getBranchHeadSha(token, repo, defaultBranch);
  if (currentHead !== run.patch_commit_sha) {
    throw new Error("Repository head changed after this update. Manual rollback is required.");
  }

  await upsertSystemSettings(db, {
    [UPDATE_SETTING_KEYS.lastUpdateStatus]: "rollback_running",
  });

  const reverted = await revertCommit(token, repo, run.patch_commit_sha, defaultBranch);
  return updateRun(db, run.id, {
    status: "rollback_running",
    rollback_commit_sha: reverted.commitSha,
    details_json: {
      ...run.details_json,
      rollback_commit_url: reverted.commitUrl,
    },
  });
}
