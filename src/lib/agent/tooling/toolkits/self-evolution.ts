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

const SELF_EVOLUTION_ACTION_KEYWORDS = [
  "fix",
  "change",
  "update",
  "modify",
  "edit",
  "add",
  "implement",
  "refactor",
  "inspect",
  "read",
  "search",
  "compare",
  "check",
  "debug",
  "revert",
  "rollback",
  "commit",
  "push",
  "patch",
  "deploy",
  "analyze",
  "修改",
  "改",
  "编辑",
  "增加",
  "新增",
  "加个",
  "加上",
  "实现",
  "重构",
  "查看",
  "读取",
  "搜索",
  "对比",
  "排查",
  "修复",
  "回退",
  "回滚",
  "提交",
  "推送",
  "补丁",
  "部署",
  "分析",
  "查",
  "查询",
];

const SELF_EVOLUTION_CONTEXT_KEYWORDS = [
  "github",
  "repo",
  "repository",
  "codebase",
  "code",
  "file",
  "files",
  "component",
  "page",
  "route",
  "api",
  "schema",
  "migration",
  "commit",
  "deploy",
  "diff",
  "patch",
  "pr",
  "仓库",
  "代码库",
  "代码",
  "文件",
  "组件",
  "页面",
  "路由",
  "接口",
  "表",
  "数据库",
  "迁移",
  "提交",
  "部署",
  "补丁",
  "diff",
];

const SELF_EVOLUTION_FORCE_TOOL_PATTERNS = [
  /github_(?:list_files|read_file|search_code|compare_commits|check_deploy|revert_commit|patch_files|commit_push)/i,
  /\b(list|read|search|compare|check|revert|rollback|commit|push|patch)\b.{0,24}\b(file|files|repo|repository|code|deploy|commit)\b/i,
  /\b(file|files|repo|repository|code|deploy|commit)\b.{0,24}\b(list|read|search|compare|check|revert|rollback|commit|push|patch)\b/i,
  /(读取|查看|搜索|对比|检查|回滚|回退|提交|推送|补丁|部署).{0,24}(文件|仓库|代码|提交|部署)/,
  /(文件|仓库|代码|提交|部署).{0,24}(读取|查看|搜索|对比|检查|回滚|回退|提交|推送|补丁)/,
];

const SELF_EVOLUTION_ACTIVATION_ONLY_PATTERNS = [
  /(激活|启用|开启|打开|开通).{0,16}(自进化|github|toolkit|技能|能力)/i,
  /\b(activate|enable|turn on)\b.{0,16}\b(self[\s_-]?evolution|github|toolkit|skill|tools?)\b/i,
];

const SELF_EVOLUTION_VAGUE_START_PATTERNS = [
  /(准备|打算|先|稍后|等会|待会|之后).{0,20}(加功能|改功能|修改|重构|开发|处理)/,
  /\b(prepare|planning|plan|later|next)\b.{0,20}\b(add|change|fix|refactor|implement)\b/i,
];

const SELF_EVOLUTION_DEPLOY_STATUS_PATTERNS = [
  /github_check_deploy/i,
  /\b(check|monitor|query|inspect|see|confirm|follow(?:\s|-)?up)\b.{0,24}\b(vercel|deploy(?:ment)?|build)\b/i,
  /\b(vercel|deploy(?:ment)?|build)\b.{0,24}\b(status|progress|ready|done|complete|completed|finished|success|failed?|error|check|monitor)\b/i,
  /(查|查询|检查|看看|确认|跟进).{0,16}(部署|构建|vercel)/,
  /(部署|构建|vercel).{0,16}(状态|进度|好了|完成|成功|失败|报错|怎么样|如何|查一下|看一下|跟进)/,
];

const SELF_EVOLUTION_FILE_HINT_PATTERN =
  /(?:^|[\s"'`(])(?:src\/|app\/|lib\/|supabase\/|scripts\/|skills\/|public\/|README(?:\.zh-CN)?\.md|package\.json|tsconfig\.json|vercel\.json|next\.config\.ts|[^/\s]+\.(?:ts|tsx|js|jsx|mjs|json|md|sql))(?:$|[\s"'`),.:])/i;

function normalizeSelfEvolutionText(messageText: string): string {
  return messageText.trim().toLowerCase();
}

function hasSelfEvolutionActionIntent(messageText: string): boolean {
  return SELF_EVOLUTION_ACTION_KEYWORDS.some((keyword) => messageText.includes(keyword));
}

function hasSelfEvolutionContextIntent(messageText: string): boolean {
  return (
    SELF_EVOLUTION_CONTEXT_KEYWORDS.some((keyword) => messageText.includes(keyword)) ||
    SELF_EVOLUTION_FILE_HINT_PATTERN.test(messageText)
  );
}

function hasSelfEvolutionActivationOnlyIntent(messageText: string): boolean {
  return SELF_EVOLUTION_ACTIVATION_ONLY_PATTERNS.some((pattern) => pattern.test(messageText));
}

function hasSelfEvolutionVagueStartIntent(messageText: string): boolean {
  return SELF_EVOLUTION_VAGUE_START_PATTERNS.some((pattern) => pattern.test(messageText));
}

function hasSelfEvolutionDeployStatusIntent(messageText: string): boolean {
  const text = normalizeSelfEvolutionText(messageText);
  if (!text.trim()) return false;
  return SELF_EVOLUTION_DEPLOY_STATUS_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldForceSelfEvolutionToolUse(messageText: string): boolean {
  return SELF_EVOLUTION_FORCE_TOOL_PATTERNS.some((pattern) => pattern.test(messageText));
}

function hasSelfEvolutionWorkflowIntent(messageText: string): boolean {
  const text = normalizeSelfEvolutionText(messageText);
  if (!text.trim()) return false;

  if (hasSelfEvolutionActivationOnlyIntent(text) || hasSelfEvolutionVagueStartIntent(text)) {
    return false;
  }

  return hasSelfEvolutionActionIntent(text) && hasSelfEvolutionContextIntent(text);
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
      "- If the user only says to activate/enable self-evolution or says they are about to start, do NOT begin repository exploration yet. Ask what feature, bug, file, or page they want changed.\n" +
      "- If the user asks about Vercel/build/deploy status, or explicitly mentions `github_check_deploy`, do NOT inspect repository files first. Call `github_check_deploy` directly using the commit SHA from the conversation context.\n" +
      "- After `github_check_deploy` returns `READY`, `NOT_FOUND`, `CANCELED`, `ERROR`, or `fatal: true`, answer immediately and stop. Only continue polling while the state is `BUILDING` or `QUEUED`, and cap it at 2-3 checks total.\n" +
      "- If `github_patch_files` fails (context mismatch), re-read the file with `github_read_file` and retry with corrected context lines.\n" +
      "- If any tool returns `fatal: true`, NEVER call that tool again in this session.\n" +
      "- After receiving ERROR from `github_check_deploy`, do NOT poll again — present logs and wait for user decision.\n" +
      "- Be efficient: plan reads upfront, minimize tool calls. Budget: ~25 steps total.\n" +
      "- Always include the full commit SHA in your reply after pushing, deploy checking, or reverting. Do NOT shorten it."
    );
  },
  getGenerateTextDirective: ({ availableToolNames, messageText }) => {
    const activeToolNames = SELF_EVOLUTION_TOOL_NAMES.filter((toolName) => availableToolNames.has(toolName));
    if (activeToolNames.length === 0) return null;

    if (availableToolNames.has("github_check_deploy") && hasSelfEvolutionDeployStatusIntent(messageText)) {
      return {
        activeTools: ["github_check_deploy"],
        toolChoice: "required",
      };
    }

    if (!hasSelfEvolutionWorkflowIntent(messageText)) {
      return null;
    }

    return {
      activeTools: [...activeToolNames],
      ...(shouldForceSelfEvolutionToolUse(messageText) ? { toolChoice: "required" } : {}),
    };
  },
};
