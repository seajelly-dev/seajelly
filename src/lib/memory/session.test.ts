import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import {
  buildSessionSummaryPromptSection,
  compactSessionMessages,
  prepareSessionHistory,
  SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
} from "@/lib/memory/session";
import type { ChatMessage, SessionSummary } from "@/types/database";

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}`,
    timestamp: new Date(Date.UTC(2026, 2, 14, 0, index, 0)).toISOString(),
  }));
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    version: 1,
    summary_text: "Existing summary",
    updated_at: "2026-03-14T00:00:00.000Z",
    summarized_message_count: 28,
    retained_recent_count: SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
    last_compacted_session_version: 4,
    model_id: "gemini-2.5-pro",
    ...overrides,
  };
}

test("prepareSessionHistory migrates legacy summary messages into metadata", () => {
  const prepared = prepareSessionHistory({
    metadata: {},
    modelId: "gemini-2.5-pro",
    messages: [
      {
        role: "system",
        content: "[Previous conversation summary] User prefers concise answers.",
      },
      ...makeMessages(2),
    ],
  });

  assert.equal(prepared.messages.length, 2);
  assert.ok(prepared.messages.every((message) => message.role !== "system"));
  assert.equal(
    prepared.metadata.session_summary?.summary_text,
    "User prefers concise answers.",
  );
  assert.match(
    buildSessionSummaryPromptSection(prepared.summary) ?? "",
    /## Session Summary/,
  );
  assert.match(
    buildSessionSummaryPromptSection(prepared.summary) ?? "",
    /trust the recent raw messages/i,
  );
});

test("compactSessionMessages leaves sessions at or below 40 messages unchanged", async () => {
  const messages = makeMessages(AGENT_LIMITS.MAX_SESSION_MESSAGES);

  const result = await compactSessionMessages({
    metadata: {},
    messages,
    modelId: "gemini-2.5-pro",
    sessionVersion: 3,
    summaryGenerator: async () => {
      throw new Error("summary generator should not be called");
    },
  });

  assert.equal(result.didCompact, false);
  assert.equal(result.usedFallback, false);
  assert.deepEqual(result.messages, messages);
  assert.equal(result.summary, null);
});

test("compactSessionMessages creates the first rolling summary and retains the latest 12 raw messages", async () => {
  const messages = makeMessages(45);
  let capturedCompressedCount = 0;
  let capturedPreviousSummary: string | null = "unexpected";

  const result = await compactSessionMessages({
    metadata: {},
    messages,
    modelId: "gemini-2.5-pro",
    sessionVersion: 7,
    summaryGenerator: async ({ previousSummary, messagesToCompress }) => {
      capturedPreviousSummary = previousSummary;
      capturedCompressedCount = messagesToCompress.length;
      return "### Current Goals\n- Build the new feature.";
    },
  });

  assert.equal(result.didCompact, true);
  assert.equal(result.usedFallback, false);
  assert.equal(capturedPreviousSummary, null);
  assert.equal(
    capturedCompressedCount,
    messages.length - SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
  );
  assert.deepEqual(
    result.messages,
    messages.slice(-SESSION_SUMMARY_RECENT_MESSAGE_COUNT),
  );
  assert.equal(
    result.summary?.summary_text,
    "### Current Goals\n- Build the new feature.",
  );
  assert.equal(
    result.summary?.summarized_message_count,
    messages.length - SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
  );
  assert.equal(
    result.summary?.retained_recent_count,
    SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
  );
  assert.equal(result.summary?.last_compacted_session_version, 8);
});

test("compactSessionMessages merges with the previous summary and keeps cumulative compressed counts", async () => {
  const existingSummary = makeSummary({
    summary_text: "### Current Goals\n- Fix deploy issue.",
    summarized_message_count: 33,
    last_compacted_session_version: 5,
  });
  const messages = makeMessages(44);
  let capturedPreviousSummary: string | null = null;

  const result = await compactSessionMessages({
    metadata: { session_summary: existingSummary },
    messages,
    modelId: "gemini-2.5-pro",
    sessionVersion: 6,
    summaryGenerator: async ({ previousSummary }) => {
      capturedPreviousSummary = previousSummary;
      return "### Current Goals\n- Fix deploy issue.\n- Add session summaries.";
    },
  });

  assert.equal(capturedPreviousSummary, existingSummary.summary_text);
  assert.equal(result.didCompact, true);
  assert.equal(result.usedFallback, false);
  assert.equal(
    result.summary?.summarized_message_count,
    existingSummary.summarized_message_count +
      (messages.length - SESSION_SUMMARY_RECENT_MESSAGE_COUNT),
  );
  assert.equal(result.summary?.last_compacted_session_version, 7);
  assert.equal(
    result.summary?.summary_text,
    "### Current Goals\n- Fix deploy issue.\n- Add session summaries.",
  );
});

test("compactSessionMessages falls back to the latest 40 raw messages when summary generation fails", async () => {
  const existingSummary = makeSummary();
  const messages = makeMessages(50);
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await compactSessionMessages({
      metadata: { session_summary: existingSummary },
      messages,
      modelId: "gemini-2.5-pro",
      sessionVersion: 9,
      summaryGenerator: async () => {
        throw new Error("simulated summary failure");
      },
    });

    assert.equal(result.didCompact, false);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(
      result.messages,
      messages.slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES),
    );
    assert.deepEqual(result.summary, existingSummary);
    assert.deepEqual(result.metadata.session_summary, existingSummary);
  } finally {
    console.warn = originalWarn;
  }
});
