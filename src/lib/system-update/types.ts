import type { PatchOperation } from "@/lib/github/patch-harness";

export const UPDATE_RUN_STATUSES = [
  "checking",
  "blocked",
  "patching",
  "deploy_pending",
  "deploy_ready",
  "deploy_error",
  "db_pending",
  "db_running",
  "success",
  "rollback_running",
  "rolled_back",
  "failed",
] as const;

export type UpdateRunStatus = (typeof UPDATE_RUN_STATUSES)[number];

export const UPDATE_DEPLOY_STATUSES = [
  "BUILDING",
  "READY",
  "ERROR",
  "QUEUED",
  "CANCELED",
  "NOT_FOUND",
] as const;

export type UpdateDeployStatus = (typeof UPDATE_DEPLOY_STATUSES)[number];

export interface UpdateManifestPatch extends PatchOperation {
  expected_blob_sha?: string;
}

export interface UpdateManifestDbConfig {
  mode: "none" | "manual_apply";
  destructive: boolean;
  sql_path?: string;
  summary?: string;
}

export interface UpdateManifest {
  manifest_version: 1;
  release_tag: string;
  release_commit_sha: string;
  previous_supported_tag: string;
  requires_manual_review?: boolean;
  required_env_keys?: string[];
  commit_message: string;
  patches: UpdateManifestPatch[];
  db: UpdateManifestDbConfig;
  notes_md?: string;
}

export interface UpstreamReleaseSummary {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
}

export interface UpgradePathStep {
  release: UpstreamReleaseSummary;
  manifest: UpdateManifest;
}

export interface UpdateRunRecord {
  id: string;
  created_by_admin_id: string | null;
  from_release_tag: string;
  to_release_tag: string;
  from_commit_sha: string | null;
  patch_commit_sha: string | null;
  rollback_commit_sha: string | null;
  local_repo: string;
  local_branch: string;
  status: UpdateRunStatus;
  deploy_status: string | null;
  deployment_id: string | null;
  deployment_url: string | null;
  has_db_changes: boolean;
  db_mode: string;
  error_summary: string | null;
  details_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
