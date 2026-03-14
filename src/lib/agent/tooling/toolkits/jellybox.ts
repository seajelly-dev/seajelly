import { JELLYBOX_TOOLKIT_KEY, JELLYBOX_TOOL_NAMES } from "../catalog";
import type { ToolkitRuntimeDefinition, ToolkitPolicyContext, ToolkitGenerateTextContext, ToolkitGenerateTextDirective } from "./self-evolution";

const JELLYBOX_FORCE_PATTERNS = [
  /jellybox_(?:upload|info|delete|usage)/i,
  /\b(upload|save|store|persist|backup)\b.{0,20}\b(to|in|into)?\s*(jellybox|cloud|r2)\b/i,
  /(上传|保存|存储|备份|转存).{0,8}(到|进|去)?\s*(jellybox|云盘|云端|r2)/i,
  /(存一下|存下来|帮我存|存起来|存到|存入|转存|备份一下)/,
  /(jellybox|云盘).{0,12}(用量|容量|空间|多少|统计|查看)/,
  /\b(jellybox|cloud.?storage)\b.{0,12}\b(usage|capacity|stat|check)\b/i,
  /(之前|上次|刚才|以前|以往|前面|早些).{0,8}(存的|保存的|上传的|传的|备份的)/,
  /(找回|找到|找一下|找下|查一下|查下|看一下|看下).{0,12}(文件|图片|照片|图像|文档|附件)/,
  /(文件|图片|照片|图像|文档|附件).{0,8}(在哪|哪里|找回|找到|还在|呢)/,
  /(我的|我存的|我传的).{0,8}(文件|图片|照片|图像|文档|附件)/,
  /\b(find|retrieve|get|list|show)\b.{0,16}\b(my|stored|saved|uploaded)\b.{0,12}\b(file|image|photo|document)s?\b/i,
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
  /(之前|上次|刚才|以前).{0,8}(存|保存|上传|传|备份)/,
  /(找回|找到|找一下|查一下|看一下).{0,12}(文件|图片|照片|图像|文档)/,
  /(我的|我存的|我传的).{0,6}(文件|图片|照片)/,
  /\b(find|retrieve|get|show|list)\b.{0,16}\b(file|image|photo|document)s?\b/i,
  /(存了|传了|保存了).{0,8}(什么|哪些|多少|几个)/,
  /(有没有|有多少|还有).{0,6}(文件|图片|照片|存储)/,
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
      "- When the user asks to find, retrieve, or look up previously stored files (e.g. \"之前存的图片呢\", \"找回我的文件\", \"show my files\"), call `jellybox_info` — with no arguments to list recent files, or with `search_name` for keyword search.\n" +
      "- Always provide the public_url to the user after a successful upload or retrieval.\n" +
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
