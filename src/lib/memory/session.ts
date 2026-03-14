import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getModel } from "@/lib/agent/provider";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import { logApiUsage, readGenerateTextUsage } from "@/lib/usage/log";
import { stringifyContent } from "@/types/database";
import type {
  ChatMessage,
  Session,
  SessionMetadata,
  SessionSummary,
  SessionTurnMarker,
} from "@/types/database";

const SESSION_SUMMARY_VERSION = 1 as const;
export const SESSION_SUMMARY_RECENT_MESSAGE_COUNT = 12;
const LEGACY_SUMMARY_PREFIX = "[Previous conversation summary]";
const MAX_FAILED_TURN_MARKERS = 10;
const MAX_RECENT_COMPLETED_EVENT_IDS = 20;
const MAX_SESSION_CAS_RETRIES = 8;
const SESSION_SELECT_FIELDS =
  "id, platform_chat_id, agent_id, channel_id, messages, metadata, active_skill_ids, version, is_active, updated_at";

export interface SessionSummaryGeneratorInput {
  previousSummary: string | null;
  messagesToCompress: ChatMessage[];
  modelId: string;
  agentId?: string | null;
  providerId?: string | null;
}

export type SessionSummaryGenerator = (
  input: SessionSummaryGeneratorInput,
) => Promise<string>;

export interface PreparedSessionHistory {
  metadata: SessionMetadata;
  messages: ChatMessage[];
  summary: SessionSummary | null;
}

export interface CompactSessionMessagesInput {
  metadata: SessionMetadata | Record<string, unknown> | null | undefined;
  messages: ChatMessage[];
  modelId: string;
  nextSessionVersion: number;
  agentId?: string | null;
  providerId?: string | null;
  summaryGenerator?: SessionSummaryGenerator;
}

export interface CompactSessionMessagesResult {
  metadata: SessionMetadata;
  messages: ChatMessage[];
  summary: SessionSummary | null;
  didCompact: boolean;
  usedFallback: boolean;
}

export interface BeginSessionTurnInput {
  supabase: SupabaseClient;
  session: Session;
  eventId: string;
  userMessage: ChatMessage;
  modelId: string;
  agentId?: string | null;
  providerId?: string | null;
  summaryGenerator?: SessionSummaryGenerator;
}

export interface BeginSessionTurnResult {
  status: "begun" | "already_completed";
  session: Session;
  preparedSession: PreparedSessionHistory;
  historyForModel: ChatMessage[];
  userMessageTimestamp: string | null;
}

export interface FinalizeSessionTurnInput {
  supabase: SupabaseClient;
  session: Session;
  eventId: string;
  assistantMessage: ChatMessage | null;
  activeSkillIds: string[];
  modelId: string;
  agentId?: string | null;
  providerId?: string | null;
  summaryGenerator?: SessionSummaryGenerator;
}

export interface FinalizeSessionTurnResult {
  status: "finalized" | "already_completed";
  session: Session;
  preparedSession: PreparedSessionHistory;
}

export interface MarkSessionTurnFailedInput {
  supabase: SupabaseClient;
  session: Session;
  eventId: string;
  errorMessage: string;
  modelId: string;
}

export interface MarkSessionTurnFailedResult {
  status: "marked_failed" | "already_completed" | "noop";
  session: Session;
  preparedSession: PreparedSessionHistory;
}

export class SessionBusyError extends Error {
  pendingEventId: string;

  constructor(pendingEventId: string) {
    super(`Session is busy with pending event ${pendingEventId}`);
    this.name = "SessionBusyError";
    this.pendingEventId = pendingEventId;
  }
}

function asSessionMetadata(
  metadata: SessionMetadata | Record<string, unknown> | null | undefined,
): SessionMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  return { ...metadata } as SessionMetadata;
}

function asNonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function readTurnMarkerRecord(value: unknown): SessionTurnMarker | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const eventId = typeof rec.event_id === "string" ? rec.event_id.trim() : "";
  const state = rec.state === "pending" || rec.state === "failed" ? rec.state : null;
  const userMessageTimestamp =
    typeof rec.user_message_timestamp === "string" ? rec.user_message_timestamp : "";
  const startedAt = typeof rec.started_at === "string" ? rec.started_at : "";
  const updatedAt = typeof rec.updated_at === "string" ? rec.updated_at : "";
  const errorMessage =
    typeof rec.error_message === "string"
      ? rec.error_message
      : rec.error_message == null
        ? null
        : null;

  if (!eventId || !state || !userMessageTimestamp || !startedAt || !updatedAt) {
    return null;
  }

  return {
    event_id: eventId,
    state,
    user_message_timestamp: userMessageTimestamp,
    started_at: startedAt,
    updated_at: updatedAt,
    error_message: errorMessage,
  };
}

export function readSessionTurnMarkers(
  metadata: SessionMetadata | Record<string, unknown> | null | undefined,
): SessionTurnMarker[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).turn_markers;
  if (!Array.isArray(raw)) return [];

  const markers: SessionTurnMarker[] = [];
  for (const entry of raw) {
    const marker = readTurnMarkerRecord(entry);
    if (marker) markers.push(marker);
  }
  return trimTurnMarkers(markers);
}

export function readRecentCompletedEventIds(
  metadata: SessionMetadata | Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).recent_completed_event_ids;
  if (!Array.isArray(raw)) return [];

  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || ids.includes(trimmed)) continue;
    ids.push(trimmed);
  }
  return ids.slice(0, MAX_RECENT_COMPLETED_EVENT_IDS);
}

export function readSessionSummary(metadata: SessionMetadata | Record<string, unknown> | null | undefined): SessionSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).session_summary;
  if (!raw || typeof raw !== "object") return null;

  const rec = raw as Record<string, unknown>;
  const summaryText = typeof rec.summary_text === "string" ? rec.summary_text.trim() : "";
  const updatedAt = typeof rec.updated_at === "string" ? rec.updated_at : "";
  const modelId = typeof rec.model_id === "string" ? rec.model_id : "";
  const version = rec.version === SESSION_SUMMARY_VERSION ? SESSION_SUMMARY_VERSION : null;

  if (!summaryText || !updatedAt || !modelId || version == null) {
    return null;
  }

  return {
    version,
    summary_text: summaryText,
    updated_at: updatedAt,
    summarized_message_count: asNonNegativeInt(rec.summarized_message_count),
    retained_recent_count: asNonNegativeInt(rec.retained_recent_count),
    last_compacted_session_version: asNonNegativeInt(rec.last_compacted_session_version),
    model_id: modelId,
  };
}

function normalizeSessionMetadataState(metadata: SessionMetadata): SessionMetadata {
  const nextMetadata: SessionMetadata = { ...metadata };
  const turnMarkers = readSessionTurnMarkers(nextMetadata);
  const recentCompletedEventIds = readRecentCompletedEventIds(nextMetadata);

  if (turnMarkers.length > 0) {
    nextMetadata.turn_markers = turnMarkers;
  } else {
    delete nextMetadata.turn_markers;
  }

  if (recentCompletedEventIds.length > 0) {
    nextMetadata.recent_completed_event_ids = recentCompletedEventIds;
  } else {
    delete nextMetadata.recent_completed_event_ids;
  }

  return nextMetadata;
}

function writeSessionStateMetadata(params: {
  metadata: SessionMetadata;
  turnMarkers: SessionTurnMarker[];
  recentCompletedEventIds: string[];
}): SessionMetadata {
  const nextMetadata = { ...params.metadata };

  if (params.turnMarkers.length > 0) {
    nextMetadata.turn_markers = params.turnMarkers;
  } else {
    delete nextMetadata.turn_markers;
  }

  if (params.recentCompletedEventIds.length > 0) {
    nextMetadata.recent_completed_event_ids = params.recentCompletedEventIds;
  } else {
    delete nextMetadata.recent_completed_event_ids;
  }

  return nextMetadata;
}

function stripLegacySummaryPrefix(content: string): string {
  if (!content.startsWith(LEGACY_SUMMARY_PREFIX)) return content.trim();
  return content.slice(LEGACY_SUMMARY_PREFIX.length).trim();
}

function mergeSummaryText(currentSummary: string | null, legacySummary: string | null): string | null {
  const current = currentSummary?.trim() ?? "";
  const legacy = legacySummary?.trim() ?? "";
  if (!current && !legacy) return null;
  if (!current) return legacy;
  if (!legacy) return current;
  if (current.includes(legacy)) return current;
  if (legacy.includes(current)) return legacy;
  return `${current}\n\n${legacy}`.trim();
}

function extractLegacySummary(messages: ChatMessage[]): {
  cleanedMessages: ChatMessage[];
  legacySummaryText: string | null;
  removedCount: number;
} {
  const legacyParts: string[] = [];
  const cleanedMessages: ChatMessage[] = [];

  for (const message of messages) {
    const contentStr = typeof message.content === "string" ? message.content : null;
    if (
      message.role === "system" &&
      contentStr &&
      contentStr.trim().startsWith(LEGACY_SUMMARY_PREFIX)
    ) {
      const stripped = stripLegacySummaryPrefix(contentStr.trim());
      if (stripped) legacyParts.push(stripped);
      continue;
    }
    cleanedMessages.push(message);
  }

  return {
    cleanedMessages,
    legacySummaryText: legacyParts.length > 0 ? legacyParts.join("\n\n") : null,
    removedCount: legacyParts.length,
  };
}

function buildSessionSummary(params: {
  summaryText: string;
  summarizedMessageCount: number;
  retainedRecentCount: number;
  sessionVersion: number;
  modelId: string;
}): SessionSummary {
  const { summaryText, summarizedMessageCount, retainedRecentCount, sessionVersion, modelId } = params;
  return {
    version: SESSION_SUMMARY_VERSION,
    summary_text: summaryText.trim(),
    updated_at: new Date().toISOString(),
    summarized_message_count: summarizedMessageCount,
    retained_recent_count: retainedRecentCount,
    last_compacted_session_version: sessionVersion,
    model_id: modelId,
  };
}

function trimTurnMarkers(markers: SessionTurnMarker[]): SessionTurnMarker[] {
  const deduped = new Map<string, SessionTurnMarker>();
  for (const marker of markers) {
    deduped.set(marker.event_id, marker);
  }

  const values = [...deduped.values()];
  const pending = values.find((marker) => marker.state === "pending");
  const failed = values
    .filter((marker) => marker.state === "failed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_FAILED_TURN_MARKERS);

  return pending ? [pending, ...failed] : failed;
}

function pushRecentCompletedEventId(eventIds: string[], eventId: string): string[] {
  return [eventId, ...eventIds.filter((id) => id !== eventId)].slice(
    0,
    MAX_RECENT_COMPLETED_EVENT_IDS,
  );
}

function removeMessageByTimestamp(messages: ChatMessage[], timestamp: string): ChatMessage[] {
  let removed = false;
  return messages.filter((message) => {
    if (!removed && message.role === "user" && message.timestamp === timestamp) {
      removed = true;
      return false;
    }
    return true;
  });
}

async function loadSessionById(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<Session> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_SELECT_FIELDS)
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load session ${sessionId}: ${error?.message ?? "not found"}`);
  }

  return data as Session;
}

async function updateSessionCas(
  supabase: SupabaseClient,
  params: {
    sessionId: string;
    expectedVersion: number;
    patch: Partial<Pick<Session, "messages" | "metadata" | "active_skill_ids" | "version">>;
  },
): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .update(params.patch)
    .eq("id", params.sessionId)
    .eq("version", params.expectedVersion)
    .select(SESSION_SELECT_FIELDS)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update session ${params.sessionId}: ${error.message}`);
  }

  return data ? (data as Session) : null;
}

function preparePersistedSession(input: {
  session: Session;
  modelId: string;
}): PreparedSessionHistory {
  return prepareSessionHistory({
    metadata: input.session.metadata ?? {},
    messages: Array.isArray(input.session.messages)
      ? (input.session.messages as ChatMessage[])
      : [],
    modelId: input.modelId,
  });
}

export function prepareSessionHistory(input: {
  metadata: SessionMetadata | Record<string, unknown> | null | undefined;
  messages: ChatMessage[];
  modelId: string;
}): PreparedSessionHistory {
  const metadata = normalizeSessionMetadataState(asSessionMetadata(input.metadata));
  const existingSummary = readSessionSummary(metadata);
  const { cleanedMessages, legacySummaryText, removedCount } = extractLegacySummary(input.messages);

  if (!legacySummaryText) {
    if (existingSummary) {
      return {
        metadata: { ...metadata, session_summary: existingSummary },
        messages: cleanedMessages,
        summary: existingSummary,
      };
    }
    if ("session_summary" in metadata) {
      const nextMetadata = { ...metadata };
      delete nextMetadata.session_summary;
      return { metadata: nextMetadata, messages: cleanedMessages, summary: null };
    }
    return { metadata, messages: cleanedMessages, summary: null };
  }

  const mergedSummaryText = mergeSummaryText(existingSummary?.summary_text ?? null, legacySummaryText);
  const nextSummary = mergedSummaryText
    ? buildSessionSummary({
        summaryText: mergedSummaryText,
        summarizedMessageCount: Math.max(existingSummary?.summarized_message_count ?? 0, removedCount),
        retainedRecentCount: Math.min(cleanedMessages.length, AGENT_LIMITS.MAX_SESSION_MESSAGES),
        sessionVersion: existingSummary?.last_compacted_session_version ?? 0,
        modelId: existingSummary?.model_id ?? input.modelId,
      })
    : null;

  const nextMetadata: SessionMetadata = { ...metadata };
  if (nextSummary) {
    nextMetadata.session_summary = nextSummary;
  } else {
    delete nextMetadata.session_summary;
  }

  return {
    metadata: nextMetadata,
    messages: cleanedMessages,
    summary: nextSummary,
  };
}

function formatSummaryTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role =
        message.role === "user"
          ? "User"
          : message.role === "assistant"
            ? "Assistant"
            : "System";
      return `${role}: ${stringifyContent(message.content)}`;
    })
    .join("\n");
}

async function generateRollingSummary(
  input: SessionSummaryGeneratorInput,
): Promise<string> {
  const startedAt = Date.now();
  const { model, resolvedProviderId, pickedKeyId } = await getModel(input.modelId, input.providerId);
  const transcript = formatSummaryTranscript(input.messagesToCompress);
  const previousSummary = input.previousSummary?.trim() || "None";

  const result = await generateText({
    model,
    system:
      "You maintain a rolling conversation summary for an AI assistant. " +
      "Merge the existing summary with the newly compressed dialogue and output concise Markdown only.\n\n" +
      "Requirements:\n" +
      "- Prefer stable facts and intent over chronological narration.\n" +
      "- Replace outdated information with newer confirmed information.\n" +
      "- Ignore greetings, filler, and repetitive back-and-forth.\n" +
      "- Keep only details that help future replies.\n" +
      "- Use short sections with these headings when relevant: `### Long-Term Preferences & Constraints`, `### Current Goals`, `### Confirmed Decisions & Facts`, `### Open Questions`, `### Important References`.\n" +
      "- Omit empty sections.\n" +
      "- Do not mention that this is a summary or compression artifact.\n" +
      "- Do not fabricate missing details.",
    messages: [
      {
        role: "user" as const,
        content:
          `Existing summary:\n${previousSummary}\n\n` +
          `New dialogue to compress:\n${transcript}`,
      },
    ],
    maxOutputTokens: 500,
  });

  await logApiUsage({
    agentId: input.agentId ?? null,
    providerId: resolvedProviderId,
    modelId: input.modelId,
    keyId: pickedKeyId,
    durationMs: Date.now() - startedAt,
    usage: readGenerateTextUsage(result),
  });

  return result.text.trim();
}

export async function compactSessionMessages(
  input: CompactSessionMessagesInput,
): Promise<CompactSessionMessagesResult> {
  const metadata = normalizeSessionMetadataState(asSessionMetadata(input.metadata));
  const previousSummary = readSessionSummary(metadata);
  const { messages, modelId, nextSessionVersion } = input;

  if (messages.length <= AGENT_LIMITS.MAX_SESSION_MESSAGES) {
    return {
      metadata,
      messages,
      summary: previousSummary,
      didCompact: false,
      usedFallback: false,
    };
  }

  const recentMessages = messages.slice(-SESSION_SUMMARY_RECENT_MESSAGE_COUNT);
  const messagesToCompress = messages.slice(0, -SESSION_SUMMARY_RECENT_MESSAGE_COUNT);
  const summaryGenerator = input.summaryGenerator ?? generateRollingSummary;

  try {
    const nextSummaryText = await summaryGenerator({
      previousSummary: previousSummary?.summary_text ?? null,
      messagesToCompress,
      modelId,
      agentId: input.agentId,
      providerId: input.providerId,
    });

    if (!nextSummaryText) {
      throw new Error("Summary model returned empty output");
    }

    const nextSummary = buildSessionSummary({
      summaryText: nextSummaryText,
      summarizedMessageCount:
        (previousSummary?.summarized_message_count ?? 0) + messagesToCompress.length,
      retainedRecentCount: recentMessages.length,
      sessionVersion: nextSessionVersion,
      modelId,
    });

    return {
      metadata: {
        ...metadata,
        session_summary: nextSummary,
      },
      messages: recentMessages,
      summary: nextSummary,
      didCompact: true,
      usedFallback: false,
    };
  } catch (error) {
    console.warn("[session-summary] compaction failed, falling back to raw message trim:", error);
    return {
      metadata,
      messages: trimSessionMessages(messages),
      summary: previousSummary,
      didCompact: false,
      usedFallback: true,
    };
  }
}

export async function beginSessionTurn(
  input: BeginSessionTurnInput,
): Promise<BeginSessionTurnResult> {
  let currentSession = input.session;

  for (let attempt = 0; attempt < MAX_SESSION_CAS_RETRIES; attempt += 1) {
    const preparedCurrent = preparePersistedSession({
      session: currentSession,
      modelId: input.modelId,
    });
    const currentMarkers = readSessionTurnMarkers(preparedCurrent.metadata);
    const recentCompletedEventIds = readRecentCompletedEventIds(preparedCurrent.metadata);

    if (recentCompletedEventIds.includes(input.eventId)) {
      return {
        status: "already_completed",
        session: currentSession,
        preparedSession: preparedCurrent,
        historyForModel: preparedCurrent.messages,
        userMessageTimestamp: null,
      };
    }

    const pendingOther = currentMarkers.find(
      (marker) => marker.state === "pending" && marker.event_id !== input.eventId,
    );
    if (pendingOther) {
      throw new SessionBusyError(pendingOther.event_id);
    }

    const now = new Date().toISOString();
    const existingMarker = currentMarkers.find((marker) => marker.event_id === input.eventId);
    const userMessageTimestamp = existingMarker?.user_message_timestamp ?? input.userMessage.timestamp ?? now;
    const nextMessages = existingMarker
      ? preparedCurrent.messages
      : [...preparedCurrent.messages, { ...input.userMessage, timestamp: userMessageTimestamp }];

    const nextMarkers = trimTurnMarkers([
      {
        event_id: input.eventId,
        state: "pending",
        user_message_timestamp: userMessageTimestamp,
        started_at: existingMarker?.started_at ?? now,
        updated_at: now,
        error_message: null,
      },
      ...currentMarkers.filter((marker) => marker.event_id !== input.eventId),
    ]);

    const compactedSession = await compactSessionMessages({
      metadata: writeSessionStateMetadata({
        metadata: preparedCurrent.metadata,
        turnMarkers: nextMarkers,
        recentCompletedEventIds,
      }),
      messages: nextMessages,
      modelId: input.modelId,
      nextSessionVersion: currentSession.version + 1,
      agentId: input.agentId,
      providerId: input.providerId,
      summaryGenerator: input.summaryGenerator,
    });

    const updatedSession = await updateSessionCas(input.supabase, {
      sessionId: currentSession.id,
      expectedVersion: currentSession.version,
      patch: {
        messages: compactedSession.messages,
        metadata: compactedSession.metadata,
        version: currentSession.version + 1,
      },
    });

    if (updatedSession) {
      const preparedUpdated = preparePersistedSession({
        session: updatedSession,
        modelId: input.modelId,
      });
      return {
        status: "begun",
        session: updatedSession,
        preparedSession: preparedUpdated,
        historyForModel: removeMessageByTimestamp(
          preparedUpdated.messages,
          userMessageTimestamp,
        ),
        userMessageTimestamp,
      };
    }

    currentSession = await loadSessionById(input.supabase, currentSession.id);
  }

  throw new Error(`Failed to begin session turn after ${MAX_SESSION_CAS_RETRIES} attempts`);
}

export async function finalizeSessionTurn(
  input: FinalizeSessionTurnInput,
): Promise<FinalizeSessionTurnResult> {
  let currentSession = input.session;

  for (let attempt = 0; attempt < MAX_SESSION_CAS_RETRIES; attempt += 1) {
    const preparedCurrent = preparePersistedSession({
      session: currentSession,
      modelId: input.modelId,
    });
    const currentMarkers = readSessionTurnMarkers(preparedCurrent.metadata);
    const recentCompletedEventIds = readRecentCompletedEventIds(preparedCurrent.metadata);

    if (recentCompletedEventIds.includes(input.eventId)) {
      return {
        status: "already_completed",
        session: currentSession,
        preparedSession: preparedCurrent,
      };
    }

    const marker = currentMarkers.find((item) => item.event_id === input.eventId);
    if (!marker) {
      throw new Error(`Cannot finalize session turn for event ${input.eventId}: marker missing`);
    }

    const nextMessages = input.assistantMessage
      ? [...preparedCurrent.messages, input.assistantMessage]
      : preparedCurrent.messages;
    const nextTurnMarkers = trimTurnMarkers(
      currentMarkers.filter((item) => item.event_id !== input.eventId),
    );
    const nextCompletedEventIds = pushRecentCompletedEventId(
      recentCompletedEventIds,
      input.eventId,
    );

    const compactedSession = await compactSessionMessages({
      metadata: writeSessionStateMetadata({
        metadata: preparedCurrent.metadata,
        turnMarkers: nextTurnMarkers,
        recentCompletedEventIds: nextCompletedEventIds,
      }),
      messages: nextMessages,
      modelId: input.modelId,
      nextSessionVersion: currentSession.version + 1,
      agentId: input.agentId,
      providerId: input.providerId,
      summaryGenerator: input.summaryGenerator,
    });

    const updatedSession = await updateSessionCas(input.supabase, {
      sessionId: currentSession.id,
      expectedVersion: currentSession.version,
      patch: {
        messages: compactedSession.messages,
        metadata: compactedSession.metadata,
        active_skill_ids: input.activeSkillIds,
        version: currentSession.version + 1,
      },
    });

    if (updatedSession) {
      return {
        status: "finalized",
        session: updatedSession,
        preparedSession: preparePersistedSession({
          session: updatedSession,
          modelId: input.modelId,
        }),
      };
    }

    currentSession = await loadSessionById(input.supabase, currentSession.id);
  }

  throw new Error(`Failed to finalize session turn after ${MAX_SESSION_CAS_RETRIES} attempts`);
}

export async function markSessionTurnFailed(
  input: MarkSessionTurnFailedInput,
): Promise<MarkSessionTurnFailedResult> {
  let currentSession = input.session;

  for (let attempt = 0; attempt < MAX_SESSION_CAS_RETRIES; attempt += 1) {
    const preparedCurrent = preparePersistedSession({
      session: currentSession,
      modelId: input.modelId,
    });
    const currentMarkers = readSessionTurnMarkers(preparedCurrent.metadata);
    const recentCompletedEventIds = readRecentCompletedEventIds(preparedCurrent.metadata);

    if (recentCompletedEventIds.includes(input.eventId)) {
      return {
        status: "already_completed",
        session: currentSession,
        preparedSession: preparedCurrent,
      };
    }

    const marker = currentMarkers.find((item) => item.event_id === input.eventId);
    if (!marker) {
      return {
        status: "noop",
        session: currentSession,
        preparedSession: preparedCurrent,
      };
    }

    const now = new Date().toISOString();
    const nextTurnMarkers = trimTurnMarkers([
      {
        ...marker,
        state: "failed",
        updated_at: now,
        error_message: input.errorMessage || null,
      },
      ...currentMarkers.filter((item) => item.event_id !== input.eventId),
    ]);

    const nextMetadata = writeSessionStateMetadata({
      metadata: preparedCurrent.metadata,
      turnMarkers: nextTurnMarkers,
      recentCompletedEventIds,
    });

    const updatedSession = await updateSessionCas(input.supabase, {
      sessionId: currentSession.id,
      expectedVersion: currentSession.version,
      patch: {
        messages: preparedCurrent.messages,
        metadata: nextMetadata,
        version: currentSession.version + 1,
      },
    });

    if (updatedSession) {
      return {
        status: "marked_failed",
        session: updatedSession,
        preparedSession: preparePersistedSession({
          session: updatedSession,
          modelId: input.modelId,
        }),
      };
    }

    currentSession = await loadSessionById(input.supabase, currentSession.id);
  }

  throw new Error(`Failed to mark session turn failed after ${MAX_SESSION_CAS_RETRIES} attempts`);
}

export function buildSessionSummaryPromptSection(summary: SessionSummary | null): string | null {
  if (!summary?.summary_text?.trim()) return null;
  return (
    "## Session Summary\n" +
    "This section is a compressed summary of earlier conversation context. " +
    "If it conflicts with the recent raw messages, trust the recent raw messages. " +
    "Do not repeat this summary as if the user just said it.\n\n" +
    summary.summary_text.trim()
  );
}

export function trimSessionMessages(
  messages: ChatMessage[],
  maxMessages = AGENT_LIMITS.MAX_SESSION_MESSAGES,
): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}

export function shouldSummarize(messages: ChatMessage[]): boolean {
  return messages.length > AGENT_LIMITS.MAX_SESSION_MESSAGES;
}
