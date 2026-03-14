import type { ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { getModel, isRateLimitError, getCooldownDuration, markKeyCooldown } from "./provider";
import { AGENT_LIMITS } from "./limits";
import {
  enforceChannelAccess,
  findOrCreateActiveSession,
  resolveOrCreateChannel,
} from "./channel-session";
import { resolveAgentRuntimeContext } from "./runtime-context";
import {
  resolveGenerateTextToolDirective,
} from "./tooling/runtime";
import { SELF_EVOLUTION_TOOL_NAMES } from "./tooling/catalog";
import { executeAgentRun, resolveAgentReply } from "./execution";
import { dispatchCommand, parseCommand } from "./commands";
import type { LoopResult } from "./commands/types";
import { buildInboundUserMessages, handlePendingImageEdit } from "./media";
import { runImageKnowledgeBypass } from "./media-search";
import { stageInboundFile, cleanupTempFile } from "@/lib/jellybox/storage";
import type { StagedFile } from "@/lib/jellybox/storage";
import { getSenderForAgent } from "@/lib/platform/sender";
import type { MCPResult } from "@/lib/mcp/client";
import type { PlatformSender } from "@/lib/platform/types";
import type { Agent, AgentEvent, ChatMessage } from "@/types/database";
import { botT, getBotLocaleOrDefault, humanizeAgentError } from "@/lib/i18n/bot";
import type { Locale } from "@/lib/i18n/types";
import { renewEventLock, markProcessed, markFailed } from "@/lib/events/queue";
import { compactSessionMessages, prepareSessionHistory } from "@/lib/memory/session";

function resolvePlatform(event: AgentEvent): string {
  const fromPayload = (event.payload as Record<string, unknown>).platform as string | undefined;
  if (fromPayload) return fromPayload;
  if (event.source === "cron" || event.source === "webhook" || event.source === "manual") {
    return "telegram";
  }
  return event.source;
}

interface ExtractedImage {
  png: string;
  toolName: string;
}

interface UsageMetrics {
  present: boolean;
  inputTokens: number;
  outputTokens: number;
}

function readToolName(stepItem: unknown): string | null {
  if (!stepItem || typeof stepItem !== "object") return null;
  const rec = stepItem as Record<string, unknown>;
  if (typeof rec.toolName === "string") return rec.toolName;
  if (typeof rec.name === "string") return rec.name;
  return null;
}

function extractImagesFromResult(result: unknown): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const root = result as Record<string, unknown>;
  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const stepRec = step as Record<string, unknown>;
    const toolResults = Array.isArray(stepRec.toolResults) ? stepRec.toolResults : [];
    for (const tr of toolResults) {
      if (!tr || typeof tr !== "object") continue;
      const rec = tr as Record<string, unknown>;
      const toolName = (typeof rec.toolName === "string" ? rec.toolName : "") as string;
      const out = (rec.output ?? rec.result) as Record<string, unknown> | undefined;
      if (!out) continue;
      const results = Array.isArray(out.results) ? out.results : [];
      for (const r of results) {
        if (r && typeof r === "object" && typeof (r as Record<string, unknown>).png === "string") {
          images.push({ png: (r as Record<string, unknown>).png as string, toolName });
        }
      }
    }
  }
  return images;
}

function extractToolNamesFromResult(result: unknown): Set<string> {
  const names = new Set<string>();

  const root = result as Record<string, unknown>;
  const topToolCalls = Array.isArray(root.toolCalls) ? root.toolCalls : [];
  for (const call of topToolCalls) {
    const name = readToolName(call);
    if (name) names.add(name);
  }

  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const stepRec = step as Record<string, unknown>;
    const stepCalls = Array.isArray(stepRec.toolCalls) ? stepRec.toolCalls : [];
    for (const call of stepCalls) {
      const name = readToolName(call);
      if (name) names.add(name);
    }
  }

  return names;
}

const SELF_EVOLUTION_TOOL_NAME_SET = new Set<string>(SELF_EVOLUTION_TOOL_NAMES);
const SELF_EVOLUTION_READ_ONLY_TOOL_NAME_SET = new Set<string>([
  "github_list_files",
  "github_read_file",
  "github_search_code",
  "github_compare_commits",
]);

function extractToolInputPath(toolCalls: unknown[]): string | null {
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const input = (call as Record<string, unknown>).input;
    if (!input || typeof input !== "object") continue;
    const path = (input as Record<string, unknown>).path;
    if (typeof path !== "string") continue;
    const trimmed = path.trim();
    return trimmed.length > 0 ? trimmed : "";
  }
  return null;
}

function extractUsageMetrics(usage: unknown): UsageMetrics {
  if (!usage || typeof usage !== "object") {
    return { present: false, inputTokens: 0, outputTokens: 0 };
  }

  const rec = usage as Record<string, unknown>;
  const inputTokens = typeof rec.inputTokens === "number" ? rec.inputTokens : 0;
  const outputTokens = typeof rec.outputTokens === "number" ? rec.outputTokens : 0;

  return {
    present: true,
    inputTokens,
    outputTokens,
  };
}

type DeployCheckState = "BUILDING" | "READY" | "ERROR" | "QUEUED" | "CANCELED" | "NOT_FOUND";

interface DeployCheckObservation {
  commitSha: string | null;
  success: boolean;
  fatal: boolean;
  state: DeployCheckState | null;
  url: string | null;
  error: string | null;
  errorMessage: string | null;
  buildLogs: string | null;
}

function readToolOutput(stepItem: unknown): Record<string, unknown> | null {
  if (!stepItem || typeof stepItem !== "object") return null;
  const rec = stepItem as Record<string, unknown>;
  const output = rec.output ?? rec.result;
  if (!output || typeof output !== "object") return null;
  return output as Record<string, unknown>;
}

function readStringField(rec: Record<string, unknown> | null, field: string): string | null {
  if (!rec) return null;
  const value = rec[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanField(rec: Record<string, unknown> | null, field: string): boolean | null {
  if (!rec) return null;
  const value = rec[field];
  return typeof value === "boolean" ? value : null;
}

function normalizeDeployCheckState(value: string | null): DeployCheckState | null {
  if (!value) return null;
  switch (value) {
    case "BUILDING":
    case "READY":
    case "ERROR":
    case "QUEUED":
    case "CANCELED":
    case "NOT_FOUND":
      return value;
    default:
      return null;
  }
}

function extractDeployCheckObservation(toolCalls: unknown[], toolResults: unknown[]): DeployCheckObservation | null {
  const deployCall = toolCalls.find((call) => readToolName(call) === "github_check_deploy");
  const deployResult = toolResults.find((result) => readToolName(result) === "github_check_deploy");
  if (!deployCall && !deployResult) return null;

  const input =
    deployCall && typeof deployCall === "object"
      ? (((deployCall as Record<string, unknown>).input as Record<string, unknown> | undefined) ?? null)
      : null;
  const output = readToolOutput(deployResult);

  return {
    commitSha: readStringField(output, "commitSha") ?? readStringField(input, "commit_sha"),
    success: readBooleanField(output, "success") ?? false,
    fatal: readBooleanField(output, "fatal") ?? false,
    state: normalizeDeployCheckState(readStringField(output, "state")),
    url: readStringField(output, "url"),
    error: readStringField(output, "error"),
    errorMessage: readStringField(output, "errorMessage"),
    buildLogs: readStringField(output, "buildLogs"),
  };
}

function summarizeDeployLogs(buildLogs: string | null): string | null {
  if (!buildLogs) return null;
  const lines = buildLogs
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-12);
  if (lines.length === 0) return null;
  const summary = lines.join("\n");
  return summary.length > 1200 ? `${summary.slice(summary.length - 1200)}` : summary;
}

function formatDeployCheckReply(params: {
  locale: Locale;
  observation: DeployCheckObservation;
  pollCount: number;
}): string {
  const { locale, observation, pollCount } = params;
  const commitLine = observation.commitSha
    ? `\n${locale === "zh" ? "提交哈希" : "Commit SHA"}: ${observation.commitSha}`
    : "";
  const targetUrl = observation.url ? `\n${locale === "zh" ? "部署地址" : "Deployment URL"}: ${observation.url}` : "";
  const detail = observation.errorMessage ?? observation.error;

  if (observation.fatal || !observation.success) {
    if (locale === "zh") {
      return `部署检查失败。${commitLine}\n错误: ${detail ?? "未知错误"}\n请先修复 Vercel 配置或稍后重试。`.trim();
    }
    return `Deployment check failed.${commitLine}\nError: ${detail ?? "Unknown error"}\nPlease fix the Vercel configuration or try again later.`.trim();
  }

  switch (observation.state) {
    case "READY":
      if (locale === "zh") {
        return `Vercel 部署已完成。${commitLine}\n状态: READY${targetUrl}`.trim();
      }
      return `The Vercel deployment is ready.${commitLine}\nStatus: READY${targetUrl}`.trim();
    case "ERROR": {
      const logSummary = summarizeDeployLogs(observation.buildLogs);
      if (locale === "zh") {
        return (
          `Vercel 构建失败。${commitLine}\n状态: ERROR` +
          `${detail ? `\n错误: ${detail}` : ""}` +
          `${targetUrl}` +
          `${logSummary ? `\n关键日志：\n${logSummary}` : ""}` +
          "\n要我现在修复后重新推送，还是回滚到上一版？"
        ).trim();
      }
      return (
        `The Vercel build failed.${commitLine}\nStatus: ERROR` +
        `${detail ? `\nError: ${detail}` : ""}` +
        `${targetUrl}` +
        `${logSummary ? `\nRelevant logs:\n${logSummary}` : ""}` +
        "\nDo you want me to fix it and push again, or revert to the previous commit?"
      ).trim();
    }
    case "NOT_FOUND":
      if (locale === "zh") {
        return `没有找到与该 commit 对应的 Vercel 部署。${commitLine}\n状态: NOT_FOUND\n请确认提交哈希和项目绑定是否正确。`.trim();
      }
      return `No Vercel deployment was found.${commitLine}\nStatus: NOT_FOUND\nPlease verify the commit SHA and project linkage.`.trim();
    case "CANCELED":
      if (locale === "zh") {
        return `Vercel 部署已取消。${commitLine}\n状态: CANCELED${targetUrl}`.trim();
      }
      return `The Vercel deployment was canceled.${commitLine}\nStatus: CANCELED${targetUrl}`.trim();
    case "BUILDING":
    case "QUEUED":
      if (locale === "zh") {
        return `Vercel 仍在${observation.state === "QUEUED" ? "排队" : "构建"}。${commitLine}\n状态: ${observation.state}\n已检查 ${pollCount} 次。${targetUrl}\n请稍后再查。`.trim();
      }
      return `The Vercel deployment is still ${observation.state === "QUEUED" ? "queued" : "building"}.${commitLine}\nStatus: ${observation.state}\nChecked ${pollCount} times.${targetUrl}\nPlease check again later.`.trim();
    default:
      if (locale === "zh") {
        return `部署检查已完成。${commitLine}${targetUrl}`.trim();
      }
      return `Deployment check completed.${commitLine}${targetUrl}`.trim();
  }
}

const STEP_PAYLOAD_MAX_CHARS = 64 * 1024;
const TELEGRAM_COALESCE_WAIT_MS = 1200;
const TELEGRAM_COALESCE_WINDOW_MS = 6000;
const TELEGRAM_COALESCE_SCAN_LIMIT = 5;
const EVENT_LOCK_SECONDS = 360;

interface EventMessageSnapshot {
  text: string;
  fileId: string | null;
  fileMime: string | null;
  fileName: string | null;
}

function readEventPlatformUid(payload: Record<string, unknown>): string | null {
  const uid = payload.platform_uid;
  if (typeof uid !== "string") return null;
  const trimmed = uid.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEventMessageSnapshot(payload: Record<string, unknown>): EventMessageSnapshot {
  const message = (payload.message as Record<string, unknown> | undefined) ?? {};
  return {
    text: typeof message.text === "string" ? message.text : "",
    fileId:
      (typeof message.file_id === "string" && message.file_id) ||
      (typeof message.photo_file_id === "string" && message.photo_file_id) ||
      null,
    fileMime: (typeof message.file_mime === "string" && message.file_mime) || null,
    fileName: (typeof message.file_name === "string" && message.file_name) || null,
  };
}

function mergePromptText(baseText: string, extraText: string): string {
  const a = baseText.trim();
  const b = extraText.trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a}\n${b}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ClaimedCompanionTextEvent {
  eventId: string;
  text: string;
}

async function claimTelegramCompanionTextEvent(params: {
  baseEvent: AgentEvent;
  agentId: string;
  platformChatId: string;
  platformUid: string;
}): Promise<ClaimedCompanionTextEvent | null> {
  const { baseEvent, agentId, platformChatId, platformUid } = params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const baseCreatedAtMs = Date.parse(baseEvent.created_at);
  if (!Number.isFinite(baseCreatedAtMs)) return null;
  const windowEnd = new Date(baseCreatedAtMs + TELEGRAM_COALESCE_WINDOW_MS).toISOString();

  const { data: candidates } = await supabase
    .from("events")
    .select("id, payload, created_at")
    .eq("source", "telegram")
    .eq("agent_id", agentId)
    .eq("platform_chat_id", platformChatId)
    .eq("status", "pending")
    .gt("created_at", baseEvent.created_at)
    .lte("created_at", windowEnd)
    .order("created_at", { ascending: true })
    .limit(TELEGRAM_COALESCE_SCAN_LIMIT);

  const candidateRows = (candidates ?? []) as Array<{
    id: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;

  for (const row of candidateRows) {
    const rowPayload = (row.payload ?? {}) as Record<string, unknown>;
    const rowUid = readEventPlatformUid(rowPayload);
    if (rowUid !== platformUid) continue;
    const snapshot = readEventMessageSnapshot(rowPayload);
    if (!snapshot.text.trim() || snapshot.fileId) continue;

    const lockedUntil = new Date(Date.now() + EVENT_LOCK_SECONDS * 1000).toISOString();
    const { data: claimed } = await supabase
      .from("events")
      .update({
        status: "processing",
        locked_until: lockedUntil,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id, payload")
      .maybeSingle();

    if (!claimed) continue;

    const claimedPayload = ((claimed as { payload: Record<string, unknown> | null }).payload ?? {}) as Record<string, unknown>;
    const claimedSnapshot = readEventMessageSnapshot(claimedPayload);
    if (!claimedSnapshot.text.trim()) continue;

    return {
      eventId: (claimed as { id: string }).id,
      text: claimedSnapshot.text,
    };
  }

  return null;
}

interface ClaimedCompanionFileEvent {
  eventId: string;
  text: string;
  fileId: string;
  fileMime: string | null;
  fileName: string | null;
}

async function claimTelegramCompanionFileEvent(params: {
  baseEvent: AgentEvent;
  agentId: string;
  platformChatId: string;
  platformUid: string;
}): Promise<ClaimedCompanionFileEvent | null> {
  const { baseEvent, agentId, platformChatId, platformUid } = params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const baseCreatedAtMs = Date.parse(baseEvent.created_at);
  if (!Number.isFinite(baseCreatedAtMs)) return null;
  const windowEnd = new Date(baseCreatedAtMs + TELEGRAM_COALESCE_WINDOW_MS).toISOString();

  const { data: candidates } = await supabase
    .from("events")
    .select("id, payload, created_at")
    .eq("source", "telegram")
    .eq("agent_id", agentId)
    .eq("platform_chat_id", platformChatId)
    .eq("status", "pending")
    .gt("created_at", baseEvent.created_at)
    .lte("created_at", windowEnd)
    .order("created_at", { ascending: true })
    .limit(TELEGRAM_COALESCE_SCAN_LIMIT);

  const candidateRows = (candidates ?? []) as Array<{
    id: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;

  for (const row of candidateRows) {
    const rowPayload = (row.payload ?? {}) as Record<string, unknown>;
    const rowUid = readEventPlatformUid(rowPayload);
    if (rowUid !== platformUid) continue;
    const snapshot = readEventMessageSnapshot(rowPayload);
    if (!snapshot.fileId) continue;

    const lockedUntil = new Date(Date.now() + EVENT_LOCK_SECONDS * 1000).toISOString();
    const { data: claimed } = await supabase
      .from("events")
      .update({
        status: "processing",
        locked_until: lockedUntil,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id, payload")
      .maybeSingle();

    if (!claimed) continue;

    const claimedRow = claimed as { id: string; payload: Record<string, unknown> | null };
    const claimedPayload = (claimedRow.payload ?? {}) as Record<string, unknown>;
    const claimedSnapshot = readEventMessageSnapshot(claimedPayload);
    if (!claimedSnapshot.fileId) continue;

    return {
      eventId: claimedRow.id,
      text: claimedSnapshot.text,
      fileId: claimedSnapshot.fileId,
      fileMime: claimedSnapshot.fileMime,
      fileName: claimedSnapshot.fileName,
    };
  }

  return null;
}

function redactSecrets(input: unknown): unknown {
  const sensitiveKey = /(token|secret|apikey|api_key|password|authorization|bearer)/i;
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v));
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (sensitiveKey.test(k)) {
        out[k] = "[REDACTED]";
      } else if (typeof v === "string" && v.length > 0 && sensitiveKey.test(v)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}

function trimPayload(input: unknown): unknown {
  try {
    const redacted = redactSecrets(input);
    const text = JSON.stringify(redacted);
    if (text.length <= STEP_PAYLOAD_MAX_CHARS) return redacted;
    return {
      _truncated: true,
      _original_length: text.length,
      _max_length: STEP_PAYLOAD_MAX_CHARS,
      _preview: text.slice(0, STEP_PAYLOAD_MAX_CHARS),
    };
  } catch {
    return { _unserializable: true };
  }
}

function extractBuildMetaFromResult(result: unknown): {
  jobId?: string;
  sandboxId?: string;
  phase?: string;
  status?: string;
} {
  const root = result as Record<string, unknown>;
  const steps = Array.isArray(root.steps) ? root.steps : [];
  const meta: { jobId?: string; sandboxId?: string; phase?: string; status?: string } = {};
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const toolResults = Array.isArray((step as Record<string, unknown>).toolResults)
      ? ((step as Record<string, unknown>).toolResults as Array<Record<string, unknown>>)
      : [];
    for (const tr of toolResults) {
      const out = (tr.output ?? tr.result) as Record<string, unknown> | undefined;
      if (!out || typeof out !== "object") continue;
      if (typeof out.jobId === "string") meta.jobId = out.jobId;
      if (typeof out.sandboxId === "string") meta.sandboxId = out.sandboxId;
      if (typeof out.phase === "string") meta.phase = out.phase;
      if (typeof out.status === "string") meta.status = out.status;
    }
  }
  return meta;
}

export async function runAgentLoop(event: AgentEvent): Promise<LoopResult> {
  const traceId = event.trace_id;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const startTime = Date.now();
  let mcpResult: MCPResult | null = null;
  let lockRenewTimer: ReturnType<typeof setInterval> | null = null;
  let coalescedCompanionEventId: string | null = null;
  let stagedFileForCleanup: StagedFile | null = null;

  const platform = resolvePlatform(event);
  let sender: PlatformSender | null = null;

  try {
    if (!event.agent_id) {
      throw new Error("No agent_id on event");
    }

    sender = await getSenderForAgent(event.agent_id, platform);


    // QQ Bot requires msg_id/event_id for passive replies
    if (platform === "qqbot" && "setReplyContext" in sender) {
      const ep = (event.payload as Record<string, unknown>).message as Record<string, unknown> | undefined;
      (sender as import("@/lib/platform/adapters/qqbot").QQBotAdapter).setReplyContext(
        ep?.msg_id as string | undefined,
        ep?.event_id as string | undefined,
      );
    }

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("*")
      .eq("id", event.agent_id)
      .single();

    if (agentErr || !agent) {
      throw new Error(`Agent not found: ${event.agent_id}`);
    }

    const typedAgent = agent as Agent;
    const platformChatId = event.platform_chat_id;
    if (!platformChatId) throw new Error("No platform_chat_id on event");

    const eventPayload = event.payload as Record<string, unknown>;
    const platformUid = readEventPlatformUid(eventPayload);
    const displayName =
      (typeof eventPayload.display_name === "string" && eventPayload.display_name) || null;

    const msgPayload = (eventPayload).message as
      | Record<string, unknown>
      | undefined;
    let messageText = (msgPayload?.text as string) || "";
    let fileId = (msgPayload?.file_id as string) || (msgPayload?.photo_file_id as string) || null;
    let fileMime = (msgPayload?.file_mime as string) || null;
    let fileName = (msgPayload?.file_name as string) || null;

    if (!messageText && !fileId) {
      throw new Error("No message text or file in payload");
    }

    const command: string | null = parseCommand(messageText).command;

    // Telegram often sends "text then image" as two close events.
    // Coalesce them into one turn to avoid the text being interpreted independently.
    if (platform === "telegram" && platformUid && messageText.trim() && !fileId && !command) {
      await sleep(TELEGRAM_COALESCE_WAIT_MS);
      const companion = await claimTelegramCompanionFileEvent({
        baseEvent: event,
        agentId: typedAgent.id,
        platformChatId,
        platformUid,
      });
      if (companion) {
        messageText = mergePromptText(messageText, companion.text);
        fileId = companion.fileId;
        fileMime = companion.fileMime;
        fileName = companion.fileName;
        coalescedCompanionEventId = companion.eventId;
        console.log(
          `[agent-loop] trace=${traceId} coalesced text+file events: base=${event.id ?? "unknown"} companion=${companion.eventId} fileMime=${companion.fileMime ?? "unknown"}`
        );
      }
    }

    // Reverse coalesce: file arrives first (e.g. Telegram sticker/webp), text follows.
    if (platform === "telegram" && platformUid && fileId && !messageText.trim()) {
      await sleep(TELEGRAM_COALESCE_WAIT_MS);
      const textCompanion = await claimTelegramCompanionTextEvent({
        baseEvent: event,
        agentId: typedAgent.id,
        platformChatId,
        platformUid,
      });
      if (textCompanion) {
        messageText = textCompanion.text;
        coalescedCompanionEventId = textCompanion.eventId;
        console.log(
          `[agent-loop] trace=${traceId} coalesced file+text events: base=${event.id ?? "unknown"} companion=${textCompanion.eventId} text="${textCompanion.text.slice(0, 50)}"`
        );
      }
    }

    // ── Resolve channel from event payload ──
    const channel = await resolveOrCreateChannel({
      supabase,
      agent: typedAgent,
      platform,
      platformUid,
      platformChatId,
      displayName,
      msgPayload,
    });
    const accessResult = await enforceChannelAccess({
      supabase,
      agent: typedAgent,
      channel,
      sender,
      platformChatId,
    });
    if (!accessResult.allowed) {
      return { success: true, reply: accessResult.reply, traceId };
    }

    // ── Session (find active or create) ──
    const session = await findOrCreateActiveSession({
      supabase,
      agentId: typedAgent.id,
      platformChatId,
      channel,
    });

    const sessionVersion = session.version as number;

    // ── Handle bot commands (no AI needed) ──
    const locale: Locale = getBotLocaleOrDefault(typedAgent.bot_locale);
    const t = (k: Parameters<typeof botT>[1], p?: Parameters<typeof botT>[2]) => botT(locale, k, p);
    const handled = await dispatchCommand({
      supabase,
      sender,
      platform,
      platformChatId,
      agent: typedAgent,
      channel,
      session,
      locale,
      t,
      traceId,
      messageText,
      event,
      command,
    });
    if (handled) return handled;

    // ── Stage inbound file: R2 temp or base64 fallback ──
    const stagedFile: StagedFile | null =
      fileId && event.agent_id
        ? await stageInboundFile({
            platform,
            agentId: event.agent_id,
            channelId: channel?.id,
            fileId,
            fileMime,
            fileName,
            logger: (msg) => console.log(`[agent-loop] trace=${traceId} ${msg}`),
          })
        : null;
    if (stagedFile) stagedFileForCleanup = stagedFile;

    // ── /imgedit image intercept ──
    const imageEditResult = await handlePendingImageEdit({
      stagedFile,
      session,
      supabase,
      sender,
      platformChatId,
      messageText,
      t,
      traceId,
    });
    if (imageEditResult?.handled && imageEditResult.result) {
      return imageEditResult.result;
    }

    const preparedSession = prepareSessionHistory({
      metadata: session.metadata ?? {},
      messages: Array.isArray(session.messages)
        ? (session.messages as ChatMessage[])
        : [],
      modelId: typedAgent.model,
    });
    const sessionMetadata = preparedSession.metadata;
    const sessionSummary = preparedSession.summary;
    const history = preparedSession.messages;

    const messages: ModelMessage[] = history
      .slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES)
      .flatMap((m: ChatMessage) =>
        m.role === "user" || m.role === "assistant"
          ? [{
              role: m.role,
              content: m.content,
            }]
          : []
      );

    const mediaBuild = buildInboundUserMessages({
      stagedFile,
      hasFileInput: Boolean(fileId),
      messageText,
      logger: (message) =>
        console.warn(
          `[agent-loop] trace=${traceId} ${message}${fileId ? ` fileId=${fileId} fileMime=${fileMime}` : ""}`,
        ),
    });
    if (mediaBuild.userWarning) {
      await sender.sendText(platformChatId, mediaBuild.userWarning);
      if (!messageText && fileId) {
        return { success: true, traceId };
      }
    }
    messages.push(...mediaBuild.userMessages);

    const hasImageInput = Boolean(
      (mediaBuild.imageBase64ForMediaSearch && mediaBuild.imageMimeForMediaSearch) ||
      mediaBuild.imageUrlForMediaSearch,
    );
    const { count: embeddingKeyCount } = await supabase
      .from("secrets")
      .select("id", { count: "exact", head: true })
      .eq("key_name", "EMBEDDING_API_KEY");
    const hasEmbeddingApiKey = (embeddingKeyCount ?? 0) > 0;
    let configuredKnowledgeEmbedModel: string | null = null;
    if (hasImageInput) {
      const { data: embedSetting } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "knowledge_embed_model")
        .maybeSingle();
      configuredKnowledgeEmbedModel = embedSetting?.value ?? null;
      if (configuredKnowledgeEmbedModel !== "gemini-embedding-2-preview") {
        console.log(
          `[agent-loop] trace=${traceId} image knowledge retrieval disabled: knowledge_embed_model=${configuredKnowledgeEmbedModel ?? "unset"}`
        );
      }
      if (!hasEmbeddingApiKey) {
        console.log(
          `[agent-loop] trace=${traceId} image knowledge retrieval disabled: missing EMBEDDING_API_KEY`
        );
      }
    }

    const { model, resolvedProviderId, pickedKeyId } = await getModel(typedAgent.model, typedAgent.provider_id);

    const toolsConfig = (typedAgent.tools_config ?? {}) as Record<string, unknown>;
    const runtimeContext = await resolveAgentRuntimeContext({
      supabase,
      agent: typedAgent,
      channel,
      sender,
      platformChatId,
      platform,
      locale,
      traceId,
      sessionId: session.id,
      sessionActiveSkillIds: Array.isArray(session.active_skill_ids)
        ? (session.active_skill_ids as string[])
        : [],
      history,
      messageText,
      sessionSummary,
      toolsConfig,
      hasEmbeddingApiKey,
      hasImageInput,
      configuredKnowledgeEmbedModel,
    });
    const tools = runtimeContext.tools;
    let systemPrompt = runtimeContext.systemPrompt;
    mcpResult = runtimeContext.mcpResult;
    const canImageKnowledgeSearchByModel = runtimeContext.canImageKnowledgeSearchByModel;
    const activeSkillIds = runtimeContext.activeSkillIds;

    const mediaSearchResult = await runImageKnowledgeBypass({
      supabase,
      traceId,
      eventId: event.id ?? null,
      agentId: typedAgent.id,
      channelId: channel?.id ?? null,
      sessionId: session.id,
      imageBase64ForMediaSearch: mediaBuild.imageBase64ForMediaSearch,
      imageMimeForMediaSearch: mediaBuild.imageMimeForMediaSearch,
      imageUrlForMediaSearch: mediaBuild.imageUrlForMediaSearch,
      hasImageInput,
      hasEmbeddingApiKey,
      canImageKnowledgeSearchByModel,
      tools: tools as Record<string, unknown>,
      trimPayload,
    });
    systemPrompt += mediaSearchResult.promptAppendix;

    // ── Inject staged file context for LLM ──
    if (stagedFile?.fileRecordId) {
      systemPrompt +=
        "\n\n## Current Turn File Context\n" +
        "A file was received this turn and is temporarily staged in JellyBox.\n" +
        `- Staged File ID: ${stagedFile.fileRecordId}\n` +
        `- File: ${stagedFile.fileName ?? "unknown"}\n` +
        `- Type: ${stagedFile.mimeType}\n` +
        `- Size: ${stagedFile.sizeBytes} bytes\n` +
        "If the user wants to save/persist this file, call `jellybox_persist` with the staged_file_id above.\n" +
        "If no storage request, the temp file will be auto-cleaned.";
    }

    if (event.id) {
      lockRenewTimer = setInterval(() => {
        renewEventLock(event.id, 360).catch(() => {});
      }, 60_000);
    }

    const toolDirective = resolveGenerateTextToolDirective({
      availableToolNames: Object.keys(tools),
      messageText,
    });
    const runWithToolDirective = !!toolDirective;

    const toolNames = Object.keys(tools);
    console.log(
      `[agent-loop] trace=${traceId} agent=${typedAgent.name} model=${typedAgent.model} tools=[${toolNames.join(",")}] toolCount=${toolNames.length} systemPromptLen=${systemPrompt.length} toolDirective=${runWithToolDirective}`,
    );

    const executionResult = await executeAgentRun({
      model,
      systemPrompt,
      messages,
      tools,
      toolDirective,
      sender,
      platformChatId,
      traceId,
      locale,
      agent: typedAgent,
      eventId: event.id ?? null,
      channelId: channel?.id ?? null,
      sessionId: session.id,
      supabase,
      resolvedProviderId,
      pickedKeyId,
      maxWallTimeMs: AGENT_LIMITS.MAX_WALL_TIME_MS,
      maxSteps: AGENT_LIMITS.MAX_STEPS,
      maxTokens: AGENT_LIMITS.MAX_TOKENS,
      payloadCharLimit: STEP_PAYLOAD_MAX_CHARS,
      readToolName,
      extractDeployCheckObservation,
      formatDeployCheckReply,
      extractToolInputPath,
      extractUsageMetrics,
      trimPayload,
      selfEvolutionReadOnlyToolNameSet: SELF_EVOLUTION_READ_ONLY_TOOL_NAME_SET,
      selfEvolutionToolNameSet: SELF_EVOLUTION_TOOL_NAME_SET,
      isRateLimitError,
      getCooldownDuration,
      markKeyCooldown,
    });
    const result = executionResult.result;
    let usageRowsInserted = executionResult.usageRowsInserted;
    let loggedInputTokens = executionResult.loggedInputTokens;
    let loggedOutputTokens = executionResult.loggedOutputTokens;

    const calledToolNames = extractToolNamesFromResult(result);
    const stepsCount = (result as unknown as Record<string, unknown>).steps
      ? ((result as unknown as Record<string, unknown>).steps as unknown[]).length
      : 0;
    const buildMeta = extractBuildMetaFromResult(result);
    console.log(
      `[agent-loop] trace=${traceId} calledTools=[${[...calledToolNames].join(",")}] steps=${stepsCount} textLen=${(result.text || "").length} jobId=${buildMeta.jobId ?? ""} sandboxId=${buildMeta.sandboxId ?? ""} phase=${buildMeta.phase ?? ""} status=${buildMeta.status ?? ""}`,
    );
    const { reply, roomToolCalled } = resolveAgentReply({
      resultText: result.text || "",
      calledToolNames,
      stepsCount,
      locale,
      maxSteps: AGENT_LIMITS.MAX_STEPS,
      noResponseText: t("noResponseGenerated"),
    });

    const usageDurationMs = Date.now() - startTime;
    const totalUsage = extractUsageMetrics(
      ((result as Record<string, unknown>).totalUsage ?? (result as Record<string, unknown>).usage)
    );
    if (usageRowsInserted === 0 && totalUsage.present) {
      try {
        await supabase.from("api_usage_logs").insert({
          agent_id: typedAgent.id,
          provider_id: resolvedProviderId,
          model_id: typedAgent.model,
          key_id: pickedKeyId,
          input_tokens: totalUsage.inputTokens,
          output_tokens: totalUsage.outputTokens,
          duration_ms: usageDurationMs,
        });
        usageRowsInserted = 1;
        loggedInputTokens = totalUsage.inputTokens;
        loggedOutputTokens = totalUsage.outputTokens;
      } catch (err) {
        console.warn(`[agent-loop] trace=${traceId} api_usage_logs fallback insert failed:`, err);
      }
    } else if (
      totalUsage.present &&
      (totalUsage.inputTokens !== loggedInputTokens || totalUsage.outputTokens !== loggedOutputTokens)
    ) {
      console.warn(
        `[agent-loop] trace=${traceId} usage mismatch total=(${totalUsage.inputTokens},${totalUsage.outputTokens}) logged=(${loggedInputTokens},${loggedOutputTokens}) rows=${usageRowsInserted}`,
      );
    }

    if (!roomToolCalled) {
      await sender.sendMarkdown(platformChatId, reply);
    }

    const extractedImages = extractImagesFromResult(result);
    console.log(`[agent-loop] trace=${traceId} extractedImages=${extractedImages.length}`);
    for (const img of extractedImages) {
      try {
        const buf = Buffer.from(img.png, "base64");
        console.log(`[agent-loop] trace=${traceId} sendPhoto tool=${img.toolName} size=${buf.length}`);
        await sender.sendPhoto(platformChatId, buf);
      } catch (photoErr) {
        console.warn(`[agent-loop] trace=${traceId} sendPhoto failed:`, photoErr);
      }
    }

    const userContent = mediaBuild.fileHandled
      ? `[File${fileName ? `: ${fileName}` : ""}]${messageText ? ` ${messageText}` : ""}`
      : messageText;

    const updatedMessages: ChatMessage[] = [
      ...history,
      {
        role: "user" as const,
        content: userContent,
        timestamp: new Date().toISOString(),
      },
      ...(
        roomToolCalled
          ? []
          : [{
              role: "assistant" as const,
              content: reply,
              timestamp: new Date().toISOString(),
            }]
      ),
    ];

    const compactedSession = await compactSessionMessages({
      metadata: sessionMetadata,
      messages: updatedMessages,
      modelId: typedAgent.model,
      sessionVersion,
      agentId: typedAgent.id,
      providerId: typedAgent.provider_id,
    });

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({
        messages: compactedSession.messages,
        metadata: compactedSession.metadata,
        active_skill_ids: activeSkillIds,
        version: sessionVersion + 1,
      })
      .eq("id", session.id)
      .eq("version", sessionVersion);

    if (updateErr) {
      console.warn(
        `Session update conflict (trace: ${traceId}):`,
        updateErr.message
      );
    }

    if (coalescedCompanionEventId) {
      await markProcessed(coalescedCompanionEventId).catch((err) => {
        console.warn(
          `[agent-loop] trace=${traceId} failed to mark coalesced companion processed: ${coalescedCompanionEventId}`,
          err
        );
      });
    }

    if (lockRenewTimer) clearInterval(lockRenewTimer);
    if (mcpResult) await mcpResult.cleanup().catch(() => {});
    if (stagedFileForCleanup?.fileRecordId) {
      await cleanupTempFile(stagedFileForCleanup.fileRecordId).catch((e) =>
        console.warn(`[agent-loop] trace=${traceId} temp cleanup failed:`, e),
      );
    }
    return { success: true, reply: roomToolCalled ? "[room_tool_handled]" : reply, traceId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Agent loop failed (trace: ${traceId}):`, errMsg);

    if (coalescedCompanionEventId) {
      await markFailed(coalescedCompanionEventId, errMsg).catch((markErr) => {
        console.warn(
          `[agent-loop] trace=${traceId} failed to mark coalesced companion failed: ${coalescedCompanionEventId}`,
          markErr
        );
      });
    }

    if (event.platform_chat_id && sender) {
      try {
        const errLocale = getBotLocaleOrDefault(
          ((await supabase.from("agents").select("bot_locale").eq("id", event.agent_id!).single()).data as { bot_locale?: string } | null)?.bot_locale
        );
        const humanError = humanizeAgentError(errLocale, err);
        await sender.sendText(event.platform_chat_id, botT(errLocale, "errorPrefix", { error: humanError }));
      } catch {
        // ignore send failure
      }
    }

    if (lockRenewTimer) clearInterval(lockRenewTimer);
    if (mcpResult) await mcpResult.cleanup().catch(() => {});
    if (stagedFileForCleanup?.fileRecordId) {
      await cleanupTempFile(stagedFileForCleanup.fileRecordId).catch((e) =>
        console.warn(`[agent-loop] trace=${traceId} temp cleanup failed:`, e),
      );
    }
    return { success: false, error: errMsg, traceId };
  }
}
