# Self-Evolution Development Best Practices

## Overview

This skill guides an AI Agent through the self-evolution pipeline — modifying the project's own codebase via GitHub, triggering Vercel auto-deployment, and rolling back if needed.

The runtime source of truth is the in-code `self_evolution_toolkit` policy and tool wiring. Treat this skill as supplementary guidance and examples, not the primary authority for permission or tool-use behavior.

## Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `github_list_files` | Get full recursive file tree | Once per task, at the start |
| `github_read_file` | Read a single file's content | Before proposing changes to that file |
| `github_patch_files` | **Apply V4A diffs (PREFERRED)** | Editing existing files (any size) |
| `github_commit_push` | Push full file contents | Creating brand-new files or files < 30 lines |
| `github_check_deploy` | Poll Vercel deployment status | After any commit/patch push |
| `github_revert_commit` | Revert a commit by SHA | Only when user explicitly requests |
| `github_compare_commits` | Compare two commits' diffs | Before revert (preview impact), or after push (review changes) |
| `github_search_code` | Search code patterns in repo | Before refactoring to find all usage sites |

## Pipeline Flow

```
1. Search/Understand → 2. Propose → 3. Confirm → 4. Patch/Commit → 5. Monitor → 6. Compare/Revert (if needed)
```

## Step-by-Step Rules

### 1. Search & Understand the Codebase

- Call `github_list_files` **once** with empty path to get the full recursive file tree.
- Use `github_search_code` to quickly locate where a function, variable, or pattern is used across the codebase. This is much faster than reading files one by one — especially useful before refactoring to find all call sites.
- Read only the files you actually need with `github_read_file`. Plan your reads upfront.
- Do NOT call `github_list_files` for individual subdirectories — one call returns everything.

### 2. Propose a Modification Plan

- Present a **clear, complete** modification plan to the user before any code push.
- Include: which files change, what changes, and a preview of the code diff.
- For new files, show the full content. For modifications, show before/after.
- If the change is trivial (docs, config), a brief summary suffices.

### 3. Wait for User Confirmation

- **NEVER** call `github_patch_files` or `github_commit_push` without explicit user approval.
- Valid approvals: "ok", "go ahead", "push it", "同意", "推送", "继续", "没问题".
- If the user provides feedback, revise the plan and re-propose.

### 4. Commit Changes

**Choose the right tool:**

- **`github_patch_files`** (preferred) — for editing existing files. You only output the changed lines as a V4A diff, drastically reducing token usage and preventing content loss in long files.
- **`github_commit_push`** — for creating entirely new files from scratch, or when the target file is very short (< 30 lines).

Both tools require conventional commit messages:

- `feat: add refresh button to dashboard` — new feature
- `fix: resolve timezone offset in cron scheduler` — bug fix
- `docs: update README with deployment instructions` — documentation
- `refactor: extract shared validation logic` — code restructuring
- `style: format coding page layout` — visual/style changes

### 5. Monitor Deployment

- **CRITICAL**: Always pass the **full 40-character commit SHA** to `github_check_deploy`. The tool result from `github_patch_files` or `github_commit_push` returns `commitSha` as a full hash (e.g. `2d85bb3e55c0aa006d85ec7b5e4f5b7950d6ad05`) — use it verbatim. NEVER truncate to a short hash (e.g. `2d85bb3`), NEVER pass invented values like `"latest"`.
- After a successful push, call `github_check_deploy` 2-3 times.
- If status is `BUILDING`, wait and tell the user to check back.
- If status is `READY`, report success with the deployment URL.
- If status is `ERROR`:
  - The result includes `buildLogs` — actual stderr/error output from the Vercel build.
  - Present the key error lines to the user (not the entire log, focus on the root cause).
  - Ask the user to choose: **(a)** fix the code and push a new commit, or **(b)** revert via `github_revert_commit`.
  - Do NOT keep polling after ERROR — the build has already terminally failed.
- If the result contains `fatal: true` (e.g. missing Vercel credentials), STOP immediately. Do NOT retry.
- Always include the **full commit SHA** in your reply for future reference (revert, deploy check, etc.).

### 6. Compare & Revert if Needed

- Use `github_compare_commits` to preview what a revert would undo, or to review what changed after a push. Pass two commit SHAs, branch names, or tags as `base` and `head`.
- Only revert when the user explicitly requests it.
- Use `github_revert_commit` with the commit SHA.
- This creates a reverse commit that triggers Vercel to redeploy the previous state.
- Failed Vercel builds do NOT affect production — only successful builds deploy.

---

## V4A Diff Format Reference

When using `github_patch_files`, each operation's `diff` field must follow V4A format.

### Line Prefixes

| Prefix | Meaning |
|--------|---------|
| `@@ ` | Hunk header — contains a recognizable anchor (e.g. function signature) |
| ` ` (space) | Context line — must match the original file exactly |
| `+` | Line to add |
| `-` | Line to remove |

### Example: Editing an Existing File (update_file)

```
@@ export async function runAgentLoop
 export async function runAgentLoop(event: AgentEvent): Promise<LoopResult> {
   const traceId = event.trace_id;
+  const patchMode = true;
   const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
```

Rules:
- The `@@ ` header anchors WHERE in the file the change applies. Use a unique, recognizable line (function signature, class declaration, etc.).
- Include 2-3 context lines (space prefix) before and after the actual change to ensure accurate matching.
- For multiple changes in the same file, use multiple `@@ ` sections in one diff.

### Example: Creating a New File (create_file)

Every content line starts with `+`:

```
+export function hello(): string {
+  return "world";
+}
```

### Example: Multiple Changes in One File

```
@@ import { generateText
 import { generateText, stepCountIs, type ModelMessage } from "ai";
+import { newDependency } from "new-package";
 import { createClient } from "@supabase/supabase-js";
@@ const GITHUB_WORKFLOW_TOOLS
 const GITHUB_WORKFLOW_TOOLS = [
   "github_read_file",
   "github_list_files",
   "github_commit_push",
+  "github_patch_files",
   "github_check_deploy",
```

### Example: Multi-File Operation

```json
{
  "operations": [
    {
      "type": "update_file",
      "path": "src/lib/agent/loop.ts",
      "diff": "@@ const TOOLS =\n const TOOLS = [\n+  \"new_tool\",\n   \"old_tool\",\n"
    },
    {
      "type": "create_file",
      "path": "src/lib/new-module.ts",
      "diff": "+export function newHelper() {\n+  return true;\n+}\n"
    },
    {
      "type": "delete_file",
      "path": "src/lib/deprecated.ts"
    }
  ],
  "message": "feat: add new_tool and remove deprecated module"
}
```

---

## Patch Failure & Retry

When `github_patch_files` fails (context mismatch, file changed since last read), it returns:

```json
{
  "success": false,
  "error": "Patch failed for src/foo.ts: Context mismatch at line 42...",
  "hint": "The file may have changed. Re-read with github_read_file and retry."
}
```

**Recovery steps:**
1. Call `github_read_file` to get the current file content.
2. Identify what changed — the context lines in your diff no longer match.
3. Rebuild the diff with correct context lines from the fresh file content.
4. Retry `github_patch_files`.

Do NOT fall back to `github_commit_push` for long files just because a patch failed — fix the diff instead.

---

## Step Budget (40 steps max)

Typical allocation for a single feature:

| Phase | Steps | Notes |
|-------|-------|-------|
| List files | 1 | Single recursive call |
| Search code | 0-2 | Use `github_search_code` to find usage sites |
| Read files | 2-5 | Only read what's needed |
| Propose plan | 1 | Text response to user |
| Wait for approval | 0 | User sends next message |
| Patch / commit | 1 | Single `github_patch_files` or `github_commit_push` call |
| Check deploy | 2-3 | Poll Vercel status |
| Compare commits | 0-1 | Optional: review what changed after push |
| **Total** | **7-13** | Leaves room for iteration |

## When to Skip Build Verification

Since we rely on Vercel's native build, there's no separate build verification step. However, be mindful:

- **Code changes** (`.ts`, `.tsx`, `.js`, `.css`): Always propose carefully, review imports and types.
- **Config changes** (`.env.example`, `next.config.ts`): Lower risk but still propose first.
- **Documentation** (`.md`, `.txt`): Minimal risk. A brief plan suffices.

## Security Principles

- The pipeline may be restricted to allowlisted agents via `GITHUB_PIPELINE_ALLOWLIST`.
- Only owner channels can push to GitHub.
- All push/revert operations are logged to `agent_step_logs` for audit.
- Never expose tokens, secrets, or API keys in commit content or messages.

## Common Pitfalls

1. **Don't output full files when editing** — use `github_patch_files` with V4A diffs. Outputting full content for a 500-line file wastes tokens and risks content loss.
2. **Don't read too many files** — plan which files matter, read only those.
3. **Don't commit without approval** — always wait for explicit user consent.
4. **Don't poll deploy forever** — check 2-3 times max. If BUILDING, tell user to ask again later.
5. **Don't ignore build errors** — when ERROR, read the `buildLogs` field, present root cause, and ask user to decide (fix or revert).
6. **Don't retry after fatal** — if a tool returns `fatal: true`, never call it again.
7. **Don't forget the commit SHA** — always include it in your reply for revert capability.
8. **Don't make multiple commits for one feature** — batch all file operations into a single `github_patch_files` call with multiple operations.
9. **Don't fall back to full-file push for patch failures** — re-read the file and fix the diff context lines instead.
10. **Don't forget `@@ ` hunk headers** — without an anchor, the diff engine may apply changes at the wrong location.
11. **Don't truncate commit SHAs** — always pass the full 40-char hash to `github_check_deploy` and `github_revert_commit`. Short hashes and made-up values like `"latest"` will fail.
