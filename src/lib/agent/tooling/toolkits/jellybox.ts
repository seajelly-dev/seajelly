import { JELLYBOX_TOOLKIT_KEY, JELLYBOX_TOOL_NAMES } from "../catalog";
import type { ToolkitRuntimeDefinition, ToolkitPolicyContext, ToolkitGenerateTextContext, ToolkitGenerateTextDirective } from "./self-evolution";

const JELLYBOX_FORCE_PATTERNS = [
  /jellybox_(?:upload|info|delete|usage)/i,
  /\b(upload|save|store|persist|backup)\b.{0,20}\b(to|in|into)?\s*(jellybox|cloud|r2)\b/i,
  /(上传|保存|存储|备份|转存).{0,8}(到|进|去)?\s*(jellybox|云盘|云端|r2)/i,
  /(存一下|存下来|帮我存|存起来|存到|存入|转存|备份一下)/,
  /(jellybox|云盘).{0,12}(用量|容量|空间|多少|统计|查看)/,
  /\b(jellybox|cloud.?storage)\b.{0,12}\b(usage|capacity|stat|check)\b/i,
];

const JELLYBOX_SOFT_PATTERNS = [
  /(存一下|存下来|帮我存|存起来|存到|存入|转存|备份一下)/,
  /(上传|保存|存储|备份|转存).{0,12}(文件|图片|照片|图像|文档|附件)/,
  /(文件|图片|照片|图像|文档|附件).{0,12}(上传|保存|存储|备份|转存|存一下)/,
  /\b(upload|save|store|persist|backup)\b.{0,20}\b(file|image|photo|document|attachment)\b/i,
  /\b(file|image|photo|document|attachment)\b.{0,20}\b(upload|save|store|persist|backup)\b/i,
  /(删除|移除|清除).{0,8}(jellybox|云盘)/,
  /\bdelete\b.{0,12}\b(from)?\s*(jellybox|cloud.?storage)\b/i,
  /(jellybox|云盘|云端存储).{0,8}(里|中|的).{0,8}(文件|图片|照片)/,
];

function hasJellyBoxIntent(messageText: string): boolean {
  return JELLYBOX_SOFT_PATTERNS.some((p) => p.test(messageText));
}

function shouldForceJellyBoxToolUse(messageText: string): boolean {
  return JELLYBOX_FORCE_PATTERNS.some((p) => p.test(messageText));
}

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
      (activeTools.includes("jellybox_upload")
        ? "- `jellybox_upload`: Upload files via URL or base64. Returns a permanent public URL.\n"
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
      "- When the user explicitly asks to save/store/persist/upload a file or image, use `jellybox_upload`.\n" +
      "- If the user just sends an image without asking to store it, do NOT auto-upload to JellyBox.\n" +
      "- Always provide the public_url to the user after a successful upload.\n" +
      "- Before deleting, confirm with the user — deletion is irreversible.\n" +
      "- Do NOT fabricate file IDs or URLs. Only return data from actual tool calls.\n" +
      "- Max file size is 50MB per upload."
    );
  },

  getGenerateTextDirective: ({ availableToolNames, messageText }: ToolkitGenerateTextContext): ToolkitGenerateTextDirective | null => {
    const activeTools = JELLYBOX_TOOL_NAMES.filter((t) => availableToolNames.has(t));
    if (activeTools.length === 0) return null;

    if (shouldForceJellyBoxToolUse(messageText)) {
      return {
        activeTools: [...activeTools],
        toolChoice: "required" as const,
      };
    }

    if (hasJellyBoxIntent(messageText)) {
      return {
        activeTools: [...activeTools],
      };
    }

    return null;
  },
};
