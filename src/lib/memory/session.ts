import { generateText } from "ai";
import { getModel } from "@/lib/agent/provider";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import { logApiUsage, readGenerateTextUsage } from "@/lib/usage/log";
import type { ChatMessage, SessionMetadata, SessionSummary } from "@/types/database";

const SESSION_SUMMARY_VERSION = 1 as const;
export const SESSION_SUMMARY_RECENT_MESSAGE_COUNT = 12;
const LEGACY_SUMMARY_PREFIX = "[Previous conversation summary]";

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
  sessionVersion: number;
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
    if (
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.trim().startsWith(LEGACY_SUMMARY_PREFIX)
    ) {
      const stripped = stripLegacySummaryPrefix(message.content.trim());
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

export function prepareSessionHistory(input: {
  metadata: SessionMetadata | Record<string, unknown> | null | undefined;
  messages: ChatMessage[];
  modelId: string;
}): PreparedSessionHistory {
  const metadata = asSessionMetadata(input.metadata);
  const existingSummary = readSessionSummary(metadata);
  const { cleanedMessages, legacySummaryText, removedCount } = extractLegacySummary(input.messages);

  if (!legacySummaryText) {
    if (existingSummary) {
      return { metadata: { ...metadata, session_summary: existingSummary }, messages: cleanedMessages, summary: existingSummary };
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
      return `${role}: ${message.content}`;
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
  const metadata = asSessionMetadata(input.metadata);
  const previousSummary = readSessionSummary(metadata);
  const { messages, modelId, sessionVersion } = input;

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
      sessionVersion: sessionVersion + 1,
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
