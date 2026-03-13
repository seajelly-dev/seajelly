import { SELF_EVOLUTION_TOOLKIT_KEY, SELF_EVOLUTION_TOOL_NAMES } from "../catalog";

export interface ToolkitPolicyContext {
  availableToolNames: Set<string>;
}

export interface ToolkitGenerateTextContext {
  availableToolNames: Set<string>;
  messageText: string;
}

export interface ToolkitGenerateTextDirective {
  activeTools: string[];
  toolChoice?: "required";
}

export interface ToolkitRuntimeDefinition {
  key: string;
  memberToolKeys: readonly string[];
  buildPolicySection?: (context: ToolkitPolicyContext) => string | null;
  getGenerateTextDirective?: (
    context: ToolkitGenerateTextContext,
  ) => ToolkitGenerateTextDirective | null;
}

function hasSelfEvolutionWorkflowIntent(messageText: string): boolean {
  const text = messageText.toLowerCase();
  if (!text.trim()) return false;

  const keywords = [
    "github",
    "repo",
    "repository",
    "commit",
    "push",
    "deploy",
    "pipeline",
    "revert",
    "rollback",
    "patch",
    "diff",
    "部署",
    "仓库",
    "代码修改",
    "提交",
    "自进化",
    "回退",
    "回滚",
    "补丁",
  ];

  return keywords.some((keyword) => text.includes(keyword));
}

export const SELF_EVOLUTION_TOOLKIT: ToolkitRuntimeDefinition = {
  key: SELF_EVOLUTION_TOOLKIT_KEY,
  memberToolKeys: SELF_EVOLUTION_TOOL_NAMES,
  buildPolicySection: ({ availableToolNames }) => {
    const activeToolNames = SELF_EVOLUTION_TOOL_NAMES.filter((toolName) => availableToolNames.has(toolName));
    if (activeToolNames.length === 0) return null;

    return (
      "## self_evolution_toolkit\n" +
      "You can read and modify the project's GitHub repository, triggering Vercel auto-deployment.\n\n" +
      "### Diff-Based Editing (Preferred)\n" +
      "When modifying existing files, ALWAYS prefer `github_patch_files` over `github_commit_push`.\n" +
      "Use V4A diff format in each operation's `diff` field:\n" +
      "- Start with `@@ <context>` header containing a recognizable line (e.g. function signature) to anchor the change location.\n" +
      "- Use space prefix (` `) for context lines that must match the original file — include 2-3 lines before and after each change.\n" +
      "- Use `-` prefix for lines to remove.\n" +
      "- Use `+` prefix for lines to add.\n" +
      "- Multiple `@@ ` sections in one diff for changes in different parts of the same file.\n\n" +
      "Example diff for update_file:\n" +
      "```\n" +
      "@@ export async function myFunc\n" +
      " export async function myFunc() {\n" +
      "-  const old = true;\n" +
      "+  const fixed = false;\n" +
      "   return fixed;\n" +
      "```\n\n" +
      "For new files (create_file), every content line starts with `+`.\n" +
      "Only use `github_commit_push` when creating entirely new files from scratch or when the file is very short (< 30 lines).\n\n" +
      "### Code Search\n" +
      "Use `github_search_code` to find where a function, variable, or pattern is used across the codebase. " +
      "This is much faster than reading files one by one. Use it before refactoring to find all usage sites.\n\n" +
      "### Compare Commits\n" +
      "Use `github_compare_commits` to see what changed between two commits. " +
      "Useful after pushing to review changes, or before reverting to preview what will be undone.\n\n" +
      "### Workflow\n" +
      "1. Understand: Call `github_list_files` ONCE (empty path = full recursive tree). Use `github_search_code` to locate specific symbols. Then `github_read_file` for files you need.\n" +
      "2. Propose: Present a clear modification plan with full code diffs to the user. NEVER skip this step.\n" +
      "3. Wait for confirmation: Only proceed when the user explicitly approves (e.g. 'ok', 'go ahead', '同意', '推送', '继续').\n" +
      "4. Commit: Call `github_patch_files` (preferred for edits) or `github_commit_push` (new files only). Use conventional commit messages.\n" +
      "5. Monitor: Call `github_check_deploy` 2-3 times to check Vercel deployment status. If still BUILDING, tell the user to wait.\n" +
      "   - CRITICAL: If `github_check_deploy` returns `fatal: true`, STOP immediately. Do NOT retry. Report the error to the user and end the monitoring.\n" +
      "   - ON ERROR: When state is `ERROR`, the result includes `buildLogs` with the actual build error output. " +
      "Present the key error lines to the user and ask: (a) fix the code and push a new commit, or (b) revert via `github_revert_commit`. " +
      "Do NOT keep polling after receiving ERROR — the build has already failed.\n" +
      "6. Revert if needed: If the user requests a rollback, use `github_revert_commit` with the commit SHA.\n\n" +
      "### Rules\n" +
      "- NEVER call `github_commit_push` or `github_patch_files` without prior user consent in the conversation.\n" +
      "- NEVER call `github_revert_commit` without explicit user request.\n" +
      "- If `github_patch_files` fails (context mismatch), re-read the file with `github_read_file` and retry with corrected context lines.\n" +
      "- If any tool returns `fatal: true`, NEVER call that tool again in this session.\n" +
      "- After receiving ERROR from `github_check_deploy`, do NOT poll again — present logs and wait for user decision.\n" +
      "- Be efficient: plan reads upfront, minimize tool calls. Budget: ~25 steps total.\n" +
      "- Always include the commit SHA in your reply after pushing, so the user can reference it for revert."
    );
  },
  getGenerateTextDirective: ({ availableToolNames, messageText }) => {
    const activeToolNames = SELF_EVOLUTION_TOOL_NAMES.filter((toolName) => availableToolNames.has(toolName));
    if (activeToolNames.length === 0) return null;

    const isFollowUpQuery = /查询|状态|继续|progress|status|check|poll|go ahead|proceed|确认|同意|推送|部署/i.test(
      messageText,
    );
    if (!hasSelfEvolutionWorkflowIntent(messageText) || isFollowUpQuery) {
      return null;
    }

    return {
      activeTools: [...activeToolNames],
      toolChoice: "required",
    };
  },
};
