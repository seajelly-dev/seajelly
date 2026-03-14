import { JELLYBOX_TOOLKIT_KEY, JELLYBOX_TOOL_NAMES } from "../catalog";
import type { ToolkitRuntimeDefinition, ToolkitPolicyContext } from "./self-evolution";

export const JELLYBOX_TOOLKIT: ToolkitRuntimeDefinition = {
  key: JELLYBOX_TOOLKIT_KEY,
  memberToolKeys: JELLYBOX_TOOL_NAMES,

  buildPolicySection: ({ availableToolNames }: ToolkitPolicyContext): string | null => {
    const activeTools = JELLYBOX_TOOL_NAMES.filter((t) => availableToolNames.has(t));
    if (activeTools.length === 0) return null;

    return (
      "## JellyBox Cloud Storage Tool Policy\n" +
      "You have access to JellyBox, a Cloudflare R2-based cloud storage system.\n\n" +
      "### Available Operations\n" +
      (activeTools.includes("jellybox_persist")
        ? "- `jellybox_persist`: Persist a temporarily staged file to permanent storage. Only call when the user explicitly asks to save/store/keep a file. The `staged_file_id` is in the 'Current Turn File Context' section of the system prompt.\n"
        : "") +
      (activeTools.includes("jellybox_info")
        ? "- `jellybox_info`: Look up file metadata by ID or search by name.\n"
        : "") +
      (activeTools.includes("jellybox_delete")
        ? "- `jellybox_delete`: Permanently delete a file from cloud storage.\n"
        : "") +
      (activeTools.includes("jellybox_usage")
        ? "- `jellybox_usage`: Check storage usage and capacity across all R2 buckets.\n"
        : "") +
      "\n### Rules\n" +
      "- When the user explicitly asks to save/store/persist/keep a file or image, use `jellybox_persist` with the staged_file_id from the file context.\n" +
      "- If the user just sends an image without asking to store it, do NOT call `jellybox_persist`.\n" +
      "- When the user asks to find or look up previously stored files, call `jellybox_info` — with no arguments for recent files, or with `search_name` for keyword search.\n" +
      "- Always provide the public_url to the user after a successful persist or retrieval.\n" +
      "- Before deleting, confirm with the user — deletion is irreversible.\n" +
      "- Do NOT fabricate file IDs or URLs. Only return data from actual tool calls."
    );
  },

  getGenerateTextDirective: () => null,
};
