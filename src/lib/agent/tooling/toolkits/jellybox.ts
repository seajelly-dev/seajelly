import { JELLYBOX_TOOLKIT_KEY, JELLYBOX_TOOL_NAMES } from "../catalog";
import type { ToolkitRuntimeDefinition, ToolkitPolicyContext, ToolkitGenerateTextContext, ToolkitGenerateTextDirective } from "./self-evolution";

const JELLYBOX_ACTION_KEYWORDS = [
  "upload", "store", "save", "persist", "download", "backup",
  "delete", "remove", "erase",
  "file", "files", "image", "photo", "document", "attachment",
  "storage", "disk", "cloud", "jellybox",
  "上传", "保存", "存储", "存档", "备份", "下载",
  "删除", "移除", "清除",
  "文件", "图片", "照片", "图像", "文档", "附件",
  "存储空间", "磁盘", "云盘", "网盘", "容量",
];

const JELLYBOX_FORCE_PATTERNS = [
  /jellybox_(?:upload|info|delete|usage)/i,
  /\b(upload|save|store|persist)\b.{0,20}\b(file|image|photo|document|attachment)\b/i,
  /\b(file|image|photo|document)\b.{0,20}\b(upload|save|store|delete|remove)\b/i,
  /(上传|保存|存储|备份|删除).{0,16}(文件|图片|照片|图像|文档|附件)/,
  /(文件|图片|照片|图像|文档|附件).{0,16}(上传|保存|存储|备份|删除|移除)/,
  /\b(storage|disk|usage|capacity|quota)\b.{0,12}\b(stat|info|check|how much)\b/i,
  /(存储|磁盘|容量|空间).{0,12}(多少|用量|统计|查看|检查)/,
];

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function hasJellyBoxIntent(messageText: string): boolean {
  const text = normalizeText(messageText);
  return JELLYBOX_ACTION_KEYWORDS.some((kw) => text.includes(kw));
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
      "- When the user wants to save, store, or persist a file/image, use `jellybox_upload`.\n" +
      "- Always provide the public_url to the user after a successful upload.\n" +
      "- Before deleting, confirm with the user — deletion is irreversible.\n" +
      "- Do NOT fabricate file IDs or URLs. Only return data from actual tool calls.\n" +
      "- Max file size is 50MB per upload."
    );
  },

  getGenerateTextDirective: ({ availableToolNames, messageText }: ToolkitGenerateTextContext): ToolkitGenerateTextDirective | null => {
    const activeTools = JELLYBOX_TOOL_NAMES.filter((t) => availableToolNames.has(t));
    if (activeTools.length === 0) return null;

    if (!hasJellyBoxIntent(messageText)) return null;

    return {
      activeTools: [...activeTools],
      ...(shouldForceJellyBoxToolUse(messageText) ? { toolChoice: "required" as const } : {}),
    };
  },
};
