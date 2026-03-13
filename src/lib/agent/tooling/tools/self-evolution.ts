import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { decrypt } from "@/lib/crypto/encrypt";
import { getGitHubConfig, parseRepo } from "@/lib/github/config";
import {
  checkVercelDeployment,
  compareCommits as githubCompareCommits,
  createCommitAndPush,
  getFile as githubGetFile,
  listTree as githubListTree,
  revertCommit,
  searchCode as githubSearchCode,
} from "@/lib/github/api";
import { applyPatchesToGitHub, type PatchOperation } from "@/lib/github/patch-harness";

interface CreateSelfEvolutionToolkitToolsOptions {
  agentId: string;
  channelId?: string;
  traceId?: string;
  supabase: SupabaseClient;
}

function redactAudit(value: unknown): unknown {
  const sensitive = /(token|secret|apikey|api_key|password|authorization|bearer)/i;
  if (Array.isArray(value)) return value.map((entry) => redactAudit(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sensitive.test(key) ? "[REDACTED]" : redactAudit(entry);
    }
    return out;
  }
  return value;
}

function truncateAudit(value: unknown, maxChars = 8 * 1024): unknown {
  try {
    const redacted = redactAudit(value);
    const text = JSON.stringify(redacted);
    if (text.length <= maxChars) return redacted;
    return {
      _truncated: true,
      _original_length: text.length,
      _preview: text.slice(0, maxChars),
    };
  } catch {
    return { _unserializable: true };
  }
}

export function createSelfEvolutionToolkitTools({
  agentId,
  channelId,
  traceId,
  supabase,
}: CreateSelfEvolutionToolkitToolsOptions) {
  function githubPipelineGuardError(): string | null {
    const raw = process.env.GITHUB_PIPELINE_ALLOWLIST?.trim();
    if (!raw) return null;
    const allowed = raw.split(",").map((value) => value.trim()).filter(Boolean);
    if (allowed.includes(agentId)) return null;
    return "GitHub pipeline is in gray release for selected agents only.";
  }

  async function writePipelineAudit(entry: {
    toolName: string;
    input?: unknown;
    output?: unknown;
    status: "success" | "failed";
    errorMessage?: string;
    latencyMs?: number;
  }): Promise<void> {
    try {
      await supabase.from("agent_step_logs").insert({
        trace_id: traceId ?? `manual-${Date.now()}`,
        event_id: null,
        agent_id: agentId,
        channel_id: channelId ?? null,
        session_id: null,
        step_no: null,
        phase: "tool",
        tool_name: entry.toolName,
        tool_input_json: truncateAudit(entry.input ?? {}),
        tool_output_json: truncateAudit(entry.output ?? {}),
        model_text: null,
        status: entry.status,
        error_message: entry.errorMessage ?? null,
        latency_ms: entry.latencyMs ?? null,
      });
    } catch {
      // non-blocking
    }
  }

  async function getSecret(key: string): Promise<string | null> {
    const { data } = await supabase
      .from("secrets")
      .select("encrypted_value")
      .eq("key_name", key)
      .single();
    if (!data?.encrypted_value) return null;
    try {
      return decrypt(data.encrypted_value);
    } catch {
      return null;
    }
  }

  async function assertOwnerChannel(action: "push" | "patch" | "revert"): Promise<string | null> {
    if (!channelId) {
      return `No channel context for ${action}.`;
    }

    const { data: callerChannel } = await supabase
      .from("channels")
      .select("id, is_owner")
      .eq("id", channelId)
      .single();

    if (!callerChannel?.is_owner) {
      if (action === "revert") return "Only the owner channel can revert commits.";
      return "Only the owner channel can push to GitHub.";
    }

    return null;
  }

  async function getRepoContext(): Promise<
    | { token: string; repo: string; repoFullName: string }
    | { error: string }
  > {
    const { token, repo } = await getGitHubConfig();
    if (!token || !repo) {
      return { error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
    }
    const { owner, name } = parseRepo(repo);
    return {
      token,
      repo,
      repoFullName: `${owner}/${name}`,
    };
  }

  return {
    github_read_file: tool({
      description:
        "Read a file from the project's GitHub repository. " +
        "Returns the file content as a string. Use this to understand existing code before making changes. " +
        "Requires GITHUB_TOKEN and GITHUB_REPO to be configured.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repo root, e.g. 'src/app/page.tsx'"),
        branch: z.string().optional().describe("Branch name, defaults to main"),
      }),
      execute: async ({ path, branch }: { path: string; branch?: string }) => {
        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        try {
          const result = await githubGetFile(repoContext.token, repoContext.repoFullName, path, branch);
          return { success: true, content: result.content, sha: result.sha };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Read failed" };
        }
      },
    }),

    github_list_files: tool({
      description:
        "List ALL files in the project's GitHub repository as a flat recursive tree. " +
        "Returns the COMPLETE file list in one call (excludes node_modules, .git, dist, lock files). " +
        "IMPORTANT: Call this ONCE with empty path to get the full project structure. " +
        "Do NOT call repeatedly for individual subdirectories — one call is enough.",
      inputSchema: z.object({
        path: z.string().optional().describe("Optional directory prefix filter. Leave empty to get the FULL repo tree (recommended)"),
        branch: z.string().optional().describe("Branch name, defaults to main"),
      }),
      execute: async ({ path, branch }: { path?: string; branch?: string }) => {
        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        try {
          const files = await githubListTree(repoContext.token, repoContext.repoFullName, path, branch);
          return {
            success: true,
            files,
            count: files.length,
            hint: "This is the full recursive file list. No need to list subdirectories separately.",
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "List failed" };
        }
      },
    }),

    github_commit_push: tool({
      description:
        "Commit and push code changes to the project's GitHub repository main branch. " +
        "This triggers Vercel auto-deployment. " +
        "CRITICAL: You MUST present the full change plan to the user and receive explicit text confirmation " +
        "(e.g. 'go ahead', 'push it', 'ok', '同意', '推送') BEFORE calling this tool. " +
        "NEVER call this without prior user consent in the conversation.",
      inputSchema: z.object({
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .describe("Files to commit, with paths relative to repo root"),
        delete_files: z
          .array(z.string())
          .optional()
          .describe("Files to delete in this commit"),
        message: z.string().describe("Git commit message (use conventional commits: feat/fix/docs/refactor)"),
        branch: z.string().optional().describe("Target branch, default: main"),
      }),
      execute: async (params: {
        files: { path: string; content: string }[];
        delete_files?: string[];
        message: string;
        branch?: string;
      }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: params,
            output: { blocked: true },
            status: "failed",
            errorMessage: guardErr,
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: guardErr };
        }

        const ownerErr = await assertOwnerChannel("push");
        if (ownerErr) {
          return { success: false, error: ownerErr };
        }

        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        const branch = params.branch ?? "main";
        try {
          const result = await createCommitAndPush(
            repoContext.token,
            repoContext.repoFullName,
            params.files,
            params.delete_files ?? [],
            params.message,
            branch,
          );
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: {
              branch,
              files_count: params.files.length,
              delete_count: params.delete_files?.length ?? 0,
            },
            output: {
              commit_sha: result.commitSha,
              commit_url: result.commitUrl,
            },
            status: "success",
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: true,
            commitSha: result.commitSha,
            commitUrl: result.commitUrl,
            message: `Committed and pushed to ${branch}: ${result.commitUrl}. Vercel will auto-deploy. Use github_check_deploy to monitor.`,
          };
        } catch (err) {
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: { branch, files_count: params.files.length },
            output: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Push failed",
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: err instanceof Error ? err.message : "Push failed" };
        }
      },
    }),

    github_patch_files: tool({
      description:
        "Apply incremental code changes to GitHub using V4A diffs. " +
        "PREFERRED over github_commit_push for modifying existing files — uses diff-based patching " +
        "so you only output changed lines instead of entire file contents. " +
        "Each operation specifies a file path and a V4A diff. " +
        "For new files, use create_file with a diff where every line starts with +. " +
        "For modifications, use update_file with context lines (space prefix) and +/- changes. " +
        "For deletions, use delete_file with just the path.\n\n" +
        "CRITICAL: You MUST present the full change plan to the user and receive explicit text confirmation " +
        "BEFORE calling this tool. NEVER call this without prior user consent.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              type: z.enum(["create_file", "update_file", "delete_file"]),
              path: z.string().describe("File path relative to repo root"),
              diff: z
                .string()
                .optional()
                .describe(
                  "V4A diff text. For update_file: include @@ context header, space-prefixed context lines, " +
                    "+added lines, -removed lines. For create_file: every content line starts with +. " +
                    "Not needed for delete_file.",
                ),
            }),
          )
          .describe("List of file operations to apply"),
        message: z.string().describe("Git commit message (use conventional commits: feat/fix/docs/refactor)"),
        branch: z.string().optional().describe("Target branch, default: main"),
      }),
      execute: async (params: {
        operations: { type: "create_file" | "update_file" | "delete_file"; path: string; diff?: string }[];
        message: string;
        branch?: string;
      }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          await writePipelineAudit({
            toolName: "github_patch_files",
            input: params,
            output: { blocked: true },
            status: "failed",
            errorMessage: guardErr,
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: guardErr };
        }

        const ownerErr = await assertOwnerChannel("patch");
        if (ownerErr) {
          return { success: false, error: ownerErr };
        }

        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        const branch = params.branch ?? "main";
        try {
          const result = await applyPatchesToGitHub(
            repoContext.token,
            repoContext.repoFullName,
            params.operations as PatchOperation[],
            params.message,
            branch,
          );
          await writePipelineAudit({
            toolName: "github_patch_files",
            input: {
              branch,
              operations_count: params.operations.length,
              files: params.operations.map((operation) => `${operation.type}:${operation.path}`),
            },
            output: {
              commit_sha: result.commitSha,
              commit_url: result.commitUrl,
              patched_files: result.patchedFiles,
            },
            status: "success",
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: true,
            commitSha: result.commitSha,
            commitUrl: result.commitUrl,
            patchedFiles: result.patchedFiles,
            message: `Patched ${result.patchedFiles.length} file(s) and pushed to ${branch}: ${result.commitUrl}. Vercel will auto-deploy. Use github_check_deploy to monitor.`,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Patch failed";
          await writePipelineAudit({
            toolName: "github_patch_files",
            input: {
              branch,
              operations_count: params.operations.length,
            },
            output: null,
            status: "failed",
            errorMessage: errMsg,
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: false,
            error: errMsg,
            hint: "The file may have changed since you last read it. Re-read with github_read_file and retry with corrected context lines.",
          };
        }
      },
    }),

    github_check_deploy: tool({
      description:
        "Check the Vercel deployment status for a specific git commit. " +
        "Call this after github_commit_push to monitor whether the deployment succeeded. " +
        "Poll 2-3 times with a few seconds between calls. If still BUILDING, tell the user to check back. " +
        "IMPORTANT: If the result contains `fatal: true`, do NOT retry — stop immediately and relay the error to the user. " +
        "When state is ERROR, the result includes `buildLogs` with the actual build error output. " +
        "Present the build logs to the user and ask whether they want to: (a) fix the code and push again, or (b) revert to the previous commit.",
      inputSchema: z.object({
        commit_sha: z.string().describe("The git commit SHA to check deployment for"),
      }),
      execute: async ({ commit_sha }: { commit_sha: string }) => {
        try {
          const vercelToken = await getSecret("VERCEL_TOKEN");
          const projectId = await getSecret("VERCEL_PROJECT_ID");
          if (!vercelToken || !projectId) {
            return {
              success: false,
              fatal: true,
              error: "VERCEL_TOKEN or VERCEL_PROJECT_ID not configured. Tell the user to set them in Dashboard > Coding > Vercel. DO NOT call this tool again.",
            };
          }
          const deployment = await checkVercelDeployment(vercelToken, projectId, commit_sha);
          return { success: true, ...deployment };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Deploy check failed" };
        }
      },
    }),

    github_revert_commit: tool({
      description:
        "Revert a specific git commit by creating a new reverse commit on the main branch. " +
        "This undoes the changes from the specified commit while preserving git history. " +
        "The new commit triggers Vercel to redeploy with the reverted code. " +
        "CRITICAL: Only call this when the user explicitly requests a revert.",
      inputSchema: z.object({
        commit_sha: z.string().describe("The SHA of the commit to revert"),
        branch: z.string().optional().describe("Branch name, default: main"),
      }),
      execute: async ({ commit_sha, branch }: { commit_sha: string; branch?: string }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          return { success: false, error: guardErr };
        }

        const ownerErr = await assertOwnerChannel("revert");
        if (ownerErr) {
          return { success: false, error: ownerErr };
        }

        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        try {
          const targetBranch = branch ?? "main";
          const result = await revertCommit(
            repoContext.token,
            repoContext.repoFullName,
            commit_sha,
            targetBranch,
          );
          await writePipelineAudit({
            toolName: "github_revert_commit",
            input: { commit_sha, branch: targetBranch },
            output: { revert_sha: result.commitSha, revert_url: result.commitUrl },
            status: "success",
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: true,
            revertCommitSha: result.commitSha,
            revertCommitUrl: result.commitUrl,
            message: `Reverted commit ${commit_sha.slice(0, 8)}. New commit: ${result.commitUrl}. Vercel will redeploy.`,
          };
        } catch (err) {
          await writePipelineAudit({
            toolName: "github_revert_commit",
            input: { commit_sha, branch: branch ?? "main" },
            output: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Revert failed",
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: err instanceof Error ? err.message : "Revert failed" };
        }
      },
    }),

    github_compare_commits: tool({
      description:
        "Compare two commits and show what changed between them. " +
        "Returns the list of changed files with additions/deletions, commit messages, and patch diffs. " +
        "Use this to review what a commit changed, preview what a revert would undo, " +
        "or understand recent modifications. " +
        "Pass two full commit SHAs, branch names, or tags as base and head.",
      inputSchema: z.object({
        base: z.string().describe("Base commit SHA, branch name, or tag (e.g. the parent commit or 'main~1')"),
        head: z.string().describe("Head commit SHA, branch name, or tag (e.g. the latest commit SHA or 'main')"),
      }),
      execute: async ({ base, head }: { base: string; head: string }) => {
        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        try {
          const result = await githubCompareCommits(repoContext.token, repoContext.repo, base, head);
          return {
            success: true,
            totalCommits: result.totalCommits,
            aheadBy: result.aheadBy,
            behindBy: result.behindBy,
            filesChanged: result.files.length,
            files: result.files.map((file) => ({
              path: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              patch: file.patch,
            })),
            commits: result.commits,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Compare failed" };
        }
      },
    }),

    github_search_code: tool({
      description:
        "Search for code patterns across the entire repository. " +
        "Returns matching file paths and code fragments. " +
        "Use this to find where a function, variable, class, or string literal is used " +
        "across the codebase — much faster than reading files one by one. " +
        "Supports GitHub code search syntax: exact phrases in quotes, language filters, path filters.",
      inputSchema: z.object({
        query: z.string().describe(
          "Search query. Examples: 'createAgentTools', '\"MAX_STEPS\"', 'language:typescript getFile', 'path:src/lib error'",
        ),
        max_results: z.number().optional().describe("Max results to return (default: 10, max: 30)"),
      }),
      execute: async ({ query, max_results }: { query: string; max_results?: number }) => {
        const repoContext = await getRepoContext();
        if ("error" in repoContext) {
          return { success: false, error: repoContext.error };
        }

        try {
          const limit = Math.min(max_results ?? 10, 30);
          const result = await githubSearchCode(repoContext.token, repoContext.repo, query, limit);
          return {
            success: true,
            totalCount: result.totalCount,
            resultCount: result.items.length,
            results: result.items.map((item) => ({
              path: item.path,
              matchedLines: item.matchedLines,
            })),
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Search failed" };
        }
      },
    }),
  };
}
