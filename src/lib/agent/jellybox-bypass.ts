import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBuiltinToolEnabled } from "./tooling/catalog";
import { uploadFile } from "@/lib/jellybox/storage";

const JELLYBOX_UPLOAD_INTENT_PATTERNS = [
  /(存一下|存下来|帮我存|存起来|存到|存入|转存|备份一下|保存一下|保存下来)/,
  /(上传|保存|存储|备份|转存).{0,8}(到|进|去)?\s*(jellybox|云盘|云端|r2)/i,
  /\b(upload|save|store|persist|backup)\b.{0,20}\b(to|in|into)?\s*(jellybox|cloud|r2)\b/i,
  /\b(save|store|upload|persist|backup)\b.{0,8}\b(this|it|the)\b/i,
];

function hasUploadIntent(messageText: string): boolean {
  return JELLYBOX_UPLOAD_INTENT_PATTERNS.some((p) => p.test(messageText));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

interface JellyBoxUploadBypassParams {
  supabase: SupabaseClient;
  traceId: string;
  eventId: string | null;
  agentId: string;
  channelId: string | null;
  sessionId: string;
  messageText: string;
  toolsConfig: Record<string, unknown> | null;
  fileBase64: string | null;
  fileMime: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  trimPayload: (input: unknown) => unknown;
}

interface JellyBoxUploadBypassResult {
  handled: boolean;
  promptAppendix: string;
}

export async function runJellyBoxUploadBypass(
  params: JellyBoxUploadBypassParams,
): Promise<JellyBoxUploadBypassResult> {
  const {
    supabase,
    traceId,
    eventId,
    agentId,
    channelId,
    sessionId,
    messageText,
    toolsConfig,
    fileBase64,
    fileMime,
    fileName,
    fileSizeBytes,
    trimPayload,
  } = params;

  const NOT_HANDLED: JellyBoxUploadBypassResult = { handled: false, promptAppendix: "" };

  if (!fileBase64 || !fileMime) return NOT_HANDLED;
  if (!hasUploadIntent(messageText)) return NOT_HANDLED;

  const jellyboxEnabled = resolveBuiltinToolEnabled(toolsConfig, "jellybox_upload");
  if (!jellyboxEnabled) return NOT_HANDLED;

  const startedAt = Date.now();
  let stepStatus: "success" | "failed" = "success";
  let stepError: string | null = null;
  let stepOutput: Record<string, unknown> = {};

  try {
    const body = Buffer.from(fileBase64, "base64");
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (body.length > MAX_FILE_SIZE) {
      stepOutput = { outcome: "skipped_too_large", bytes: body.length };
      return NOT_HANDLED;
    }

    const originalName = fileName || `upload_${Date.now()}.${fileMime.split("/")[1] || "bin"}`;

    console.log(
      `[agent-loop] trace=${traceId} jellybox-bypass: uploading file=${originalName} size=${formatBytes(body.length)} mime=${fileMime}`,
    );

    const result = await uploadFile({
      body,
      originalName,
      mimeType: fileMime,
      agentId,
      channelId: channelId ?? undefined,
    });

    stepOutput = {
      outcome: "uploaded",
      fileId: result.fileId,
      publicUrl: result.publicUrl,
      fileSize: result.fileSize,
      storageName: result.storageName,
    };

    console.log(
      `[agent-loop] trace=${traceId} jellybox-bypass: success fileId=${result.fileId} url=${result.publicUrl}`,
    );

    const promptAppendix =
      "\n\n## JellyBox Upload Result\n" +
      `The user's file has been automatically saved to JellyBox cloud storage.\n` +
      `- **File**: ${originalName}\n` +
      `- **Size**: ${formatBytes(result.fileSize)}\n` +
      `- **Public URL**: ${result.publicUrl}\n` +
      `- **File ID**: ${result.fileId}\n` +
      `- **Storage**: ${result.storageName}\n\n` +
      "Tell the user the file has been saved and provide the public URL. " +
      "Do NOT call jellybox_upload again — the upload is already complete.";

    return { handled: true, promptAppendix };
  } catch (err) {
    stepStatus = "failed";
    stepError = err instanceof Error ? err.message : "JellyBox upload bypass exception";
    stepOutput = { outcome: "exception", error: stepError };
    console.warn(`[agent-loop] trace=${traceId} jellybox-bypass error:`, err);
    return NOT_HANDLED;
  } finally {
    try {
      await supabase.from("agent_step_logs").insert({
        trace_id: traceId,
        event_id: eventId,
        agent_id: agentId,
        channel_id: channelId,
        session_id: sessionId,
        step_no: 0,
        phase: "tool",
        tool_name: "jellybox_upload_bypass",
        tool_input_json: trimPayload({
          fileName,
          fileMime,
          fileSizeBytes,
          messageText,
        }),
        tool_output_json: trimPayload(stepOutput),
        model_text: "",
        status: stepStatus,
        error_message: stepError,
        latency_ms: Math.max(0, Date.now() - startedAt),
      });
    } catch {
      // non-blocking
    }
  }
}
