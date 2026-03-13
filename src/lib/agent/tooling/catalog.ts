export interface BuiltinToolDefinition {
  key: string;
  label: string;
  descKey: string;
  defaultOn: boolean;
}

export interface BuiltinToolkitDefinition {
  key: string;
  label: string;
  descKey: string;
  defaultOn: boolean;
  memberToolKeys: readonly string[];
}

export const SELF_EVOLUTION_TOOLKIT_KEY = "self_evolution_toolkit" as const;

export const SELF_EVOLUTION_TOOL_NAMES = [
  "github_read_file",
  "github_list_files",
  "github_commit_push",
  "github_patch_files",
  "github_check_deploy",
  "github_revert_commit",
  "github_compare_commits",
  "github_search_code",
] as const;

export const BUILTIN_TOOL_CATALOG = [
  { key: "knowledge_search", label: "knowledge_search", descKey: "agents.toolKnowledgeSearch", defaultOn: false },
  { key: "run_sql", label: "run_sql", descKey: "agents.toolRunSql", defaultOn: false },
  { key: "schedule_task", label: "schedule_task", descKey: "agents.toolScheduleTask", defaultOn: true },
  { key: "cancel_scheduled_job", label: "cancel_scheduled_job", descKey: "agents.toolCancelJob", defaultOn: true },
  { key: "list_scheduled_jobs", label: "list_scheduled_jobs", descKey: "agents.toolListJobs", defaultOn: true },
  { key: "run_python_code", label: "run_python_code", descKey: "coding.toolRunPython", defaultOn: false },
  { key: "run_javascript_code", label: "run_javascript_code", descKey: "coding.toolRunJS", defaultOn: false },
  { key: "run_html_preview", label: "run_html_preview", descKey: "coding.toolRunHTML", defaultOn: false },
  { key: "github_read_file", label: "github_read_file", descKey: "coding.toolGitHubReadFile", defaultOn: false },
  { key: "github_list_files", label: "github_list_files", descKey: "coding.toolGitHubListFiles", defaultOn: false },
  { key: "github_commit_push", label: "github_commit_push", descKey: "coding.toolGitHubCommitPush", defaultOn: false },
  { key: "github_patch_files", label: "github_patch_files", descKey: "coding.toolGitHubPatchFiles", defaultOn: false },
  { key: "github_check_deploy", label: "github_check_deploy", descKey: "coding.toolGitHubCheckDeploy", defaultOn: false },
  { key: "github_revert_commit", label: "github_revert_commit", descKey: "coding.toolGitHubRevertCommit", defaultOn: false },
  { key: "github_compare_commits", label: "github_compare_commits", descKey: "coding.toolGitHubCompareCommits", defaultOn: false },
  { key: "github_search_code", label: "github_search_code", descKey: "coding.toolGitHubSearchCode", defaultOn: false },
  { key: "tts_speak", label: "tts_speak", descKey: "coding.toolTtsSpeak", defaultOn: false },
  { key: "image_generate", label: "image_generate", descKey: "coding.toolImageGenerate", defaultOn: false },
] as const satisfies readonly BuiltinToolDefinition[];

export const BUILTIN_TOOLKIT_CATALOG = [
  {
    key: SELF_EVOLUTION_TOOLKIT_KEY,
    label: SELF_EVOLUTION_TOOLKIT_KEY,
    descKey: "coding.toolkitSelfEvolution",
    defaultOn: false,
    memberToolKeys: SELF_EVOLUTION_TOOL_NAMES,
  },
] as const satisfies readonly BuiltinToolkitDefinition[];

export type BuiltinToolKey = (typeof BUILTIN_TOOL_CATALOG)[number]["key"];
export type BuiltinToolkitKey = (typeof BUILTIN_TOOLKIT_CATALOG)[number]["key"];

type ToolsConfigLike = Record<string, unknown> | null | undefined;

export const BUILTIN_TOOL_DEFAULTS: Record<BuiltinToolKey, boolean> = Object.fromEntries(
  BUILTIN_TOOL_CATALOG.map((tool) => [tool.key, tool.defaultOn]),
) as Record<BuiltinToolKey, boolean>;

export const BUILTIN_TOOL_KEY_SET = new Set<string>(BUILTIN_TOOL_CATALOG.map((tool) => tool.key));

export const TOOLKIT_MEMBER_KEY_SET = new Set<string>(
  BUILTIN_TOOLKIT_CATALOG.flatMap((toolkit) => [...toolkit.memberToolKeys]),
);

const TOOLKIT_BY_KEY = new Map<string, BuiltinToolkitDefinition>(
  BUILTIN_TOOLKIT_CATALOG.map((toolkit) => [toolkit.key, toolkit]),
);

const TOOL_BY_KEY = new Map<string, BuiltinToolDefinition>(
  BUILTIN_TOOL_CATALOG.map((tool) => [tool.key, tool]),
);

const TOOLKIT_KEYS_BY_MEMBER = BUILTIN_TOOLKIT_CATALOG.reduce<Record<string, string[]>>((acc, toolkit) => {
  for (const memberToolKey of toolkit.memberToolKeys) {
    if (!acc[memberToolKey]) acc[memberToolKey] = [];
    acc[memberToolKey].push(toolkit.key);
  }
  return acc;
}, {});

export function readToolsConfigBoolean(config: ToolsConfigLike, key: string): boolean | undefined {
  const value = config?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function getBuiltinToolDefinition(key: string): BuiltinToolDefinition | undefined {
  return TOOL_BY_KEY.get(key);
}

export function getBuiltinToolkitDefinition(key: string): BuiltinToolkitDefinition | undefined {
  return TOOLKIT_BY_KEY.get(key);
}

export function getToolkitMemberToolKeys(toolkitKey: string): readonly string[] {
  return TOOLKIT_BY_KEY.get(toolkitKey)?.memberToolKeys ?? [];
}

export function isToolkitManagedBuiltinToolKey(toolKey: string): boolean {
  return TOOLKIT_MEMBER_KEY_SET.has(toolKey);
}

export function buildInitialToolsConfig(): Record<string, boolean> {
  const initial: Record<string, boolean> = {};

  for (const toolkit of BUILTIN_TOOLKIT_CATALOG) {
    initial[toolkit.key] = toolkit.defaultOn;
  }

  for (const tool of BUILTIN_TOOL_CATALOG) {
    if (isToolkitManagedBuiltinToolKey(tool.key)) continue;
    initial[tool.key] = tool.defaultOn;
  }

  return initial;
}

export function resolveToolkitEnabled(config: ToolsConfigLike, toolkitKey: string): boolean {
  const explicit = readToolsConfigBoolean(config, toolkitKey);
  if (explicit !== undefined) return explicit;
  return getToolkitMemberToolKeys(toolkitKey).some((toolKey) => readToolsConfigBoolean(config, toolKey) === true);
}

export function resolveBuiltinToolEnabled(config: ToolsConfigLike, toolKey: string): boolean {
  const direct = readToolsConfigBoolean(config, toolKey);
  const toolkitKeys = TOOLKIT_KEYS_BY_MEMBER[toolKey] ?? [];
  const toolkitStates = toolkitKeys
    .map((toolkitKey) => readToolsConfigBoolean(config, toolkitKey))
    .filter((value): value is boolean => value !== undefined);

  if (toolkitStates.some((value) => value === false)) {
    return false;
  }

  if (toolkitStates.some((value) => value === true)) {
    return direct ?? true;
  }

  if (direct !== undefined) {
    return direct;
  }

  const tool = getBuiltinToolDefinition(toolKey);
  return tool?.defaultOn ?? false;
}

export function countEnabledBuiltinTools(config: ToolsConfigLike): number {
  return BUILTIN_TOOL_CATALOG.reduce((count, tool) => {
    return count + (resolveBuiltinToolEnabled(config, tool.key) ? 1 : 0);
  }, 0);
}
