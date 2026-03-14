import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import {
  beginSessionTurn,
  buildSessionSummaryPromptSection,
  compactSessionMessages,
  finalizeSessionTurn,
  markSessionTurnFailed,
  prepareSessionHistory,
  readRecentCompletedEventIds,
  readSessionTurnMarkers,
  SESSION_SUMMARY_RECENT_MESSAGE_COUNT,
  SessionBusyError,
} from "@/lib/memory/session";
import type { ChatMessage, Session, SessionSummary } from "@/types/database";

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session_1",
    platform_chat_id: "chat_1",
    agent_id: "agent_1",
    channel_id: null,
    messages: [],
    metadata: {},
    active_skill_ids: [],
    version: 1,
    is_active: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function matchesSessionFilters(
  session: Session,
  filters: Array<{ column: keyof Session; value: unknown }>,
): boolean {
  return filters.every(({ column, value }) => session[column] === value);
}

function createSessionSupabase(initialSession: Session) {
  let session = structuredClone(initialSession);

  const supabase = {
    from(table: string) {
      if (table !== "sessions") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Array<{ column: keyof Session; value: unknown }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column: column as keyof Session, value });
              return query;
            },
            async single() {
              if (matchesSessionFilters(session, filters)) {
                return { data: structuredClone(session), error: null };
              }
              return { data: null, error: { message: "not found" } };
            },
          };
          return query;
        },
        update(patch: Partial<Session>) {
          const filters: Array<{ column: keyof Session; value: unknown }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column: column as keyof Session, value });
              return query;
            },
            select() {
              return {
                async maybeSingle() {
                  if (!matchesSessionFilters(session, filters)) {
                    return { data: null, error: null };
                  }
                  session = {
                    ...session,
                    ...structuredClone(patch),
                  } as Session;
                  return { data: structuredClone(session), error: null };
                },
              };
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    readSession: () => structuredClone(session) as Session,
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
    nextSessionVersion: 3,
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
    nextSessionVersion: 8,
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
    nextSessionVersion: 7,
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
      nextSessionVersion: 10,
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

test("beginSessionTurn persists the user message, adds a pending marker, and returns model history without the current turn", async () => {
  const initialSession = makeSession({
    messages: makeMessages(4),
    version: 3,
  });
  const { supabase, readSession } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "hello there",
    timestamp: "2026-03-14T01:00:00.000Z",
  };

  const result = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_1",
    userMessage,
    modelId: "gemini-2.5-pro",
  });

  assert.equal(result.status, "begun");
  assert.equal(result.session.version, 4);
  assert.equal(result.historyForModel.length, initialSession.messages.length);
  assert.equal(readSession().messages.length, 5);
  assert.deepEqual(readSession().messages.at(-1), userMessage);
  const markers = readSessionTurnMarkers(readSession().metadata);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.state, "pending");
  assert.equal(markers[0]?.user_message_timestamp, userMessage.timestamp);
});

test("beginSessionTurn compacts oversized history during begin and writes the summary version for that update", async () => {
  const initialSession = makeSession({
    messages: makeMessages(40),
    version: 7,
  });
  const { supabase, readSession } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "newest turn",
    timestamp: "2026-03-14T02:00:00.000Z",
  };

  const result = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_overflow",
    userMessage,
    modelId: "gemini-2.5-pro",
    summaryGenerator: async () => "### Current Goals\n- Handle overflow.",
  });

  assert.equal(result.status, "begun");
  assert.equal(result.session.version, 8);
  assert.equal(result.preparedSession.summary?.last_compacted_session_version, 8);
  assert.equal(result.preparedSession.messages.length, SESSION_SUMMARY_RECENT_MESSAGE_COUNT);
  assert.equal(result.historyForModel.length, SESSION_SUMMARY_RECENT_MESSAGE_COUNT - 1);
  assert.equal(readSession().metadata.session_summary?.summary_text, "### Current Goals\n- Handle overflow.");
});

test("beginSessionTurn throws SessionBusyError when another event is pending", async () => {
  const initialSession = makeSession({
    version: 2,
    metadata: {
      turn_markers: [
        {
          event_id: "event_pending",
          state: "pending",
          user_message_timestamp: "2026-03-14T03:00:00.000Z",
          started_at: "2026-03-14T03:00:00.000Z",
          updated_at: "2026-03-14T03:00:00.000Z",
          error_message: null,
        },
      ],
    },
  });
  const { supabase } = createSessionSupabase(initialSession);

  await assert.rejects(
    () =>
      beginSessionTurn({
        supabase,
        session: initialSession,
        eventId: "event_2",
        userMessage: {
          role: "user",
          content: "new turn",
          timestamp: "2026-03-14T03:01:00.000Z",
        },
        modelId: "gemini-2.5-pro",
      }),
    SessionBusyError,
  );
});

test("markSessionTurnFailed keeps the user message and converts the marker to failed", async () => {
  const initialSession = makeSession({
    messages: makeMessages(2),
    version: 1,
  });
  const { supabase } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "please help",
    timestamp: "2026-03-14T04:00:00.000Z",
  };

  const begun = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_fail",
    userMessage,
    modelId: "gemini-2.5-pro",
  });

  const failed = await markSessionTurnFailed({
    supabase,
    session: begun.session,
    eventId: "event_fail",
    errorMessage: "simulated crash",
    modelId: "gemini-2.5-pro",
  });

  assert.equal(failed.status, "marked_failed");
  assert.equal(failed.session.messages.at(-1)?.content, "please help");
  const markers = readSessionTurnMarkers(failed.session.metadata);
  assert.equal(markers[0]?.state, "failed");
  assert.equal(markers[0]?.error_message, "simulated crash");
});

test("beginSessionTurn recovers the same failed event without duplicating the user message", async () => {
  const initialSession = makeSession({
    messages: makeMessages(2),
    version: 1,
  });
  const { supabase, readSession } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "recover me",
    timestamp: "2026-03-14T05:00:00.000Z",
  };

  const begun = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_retry",
    userMessage,
    modelId: "gemini-2.5-pro",
  });
  await markSessionTurnFailed({
    supabase,
    session: begun.session,
    eventId: "event_retry",
    errorMessage: "temporary issue",
    modelId: "gemini-2.5-pro",
  });

  const resumed = await beginSessionTurn({
    supabase,
    session: readSession(),
    eventId: "event_retry",
    userMessage,
    modelId: "gemini-2.5-pro",
  });

  assert.equal(resumed.status, "begun");
  assert.equal(readSession().messages.filter((message) => message.content === "recover me").length, 1);
  assert.equal(readSessionTurnMarkers(readSession().metadata)[0]?.state, "pending");
});

test("finalizeSessionTurn appends assistant, clears markers, and records completed event ids", async () => {
  const initialSession = makeSession({
    messages: makeMessages(2),
    version: 1,
  });
  const { supabase, readSession } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "question",
    timestamp: "2026-03-14T06:00:00.000Z",
  };

  const begun = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_done",
    userMessage,
    modelId: "gemini-2.5-pro",
  });
  const finalized = await finalizeSessionTurn({
    supabase,
    session: begun.session,
    eventId: "event_done",
    assistantMessage: {
      role: "assistant",
      content: "answer",
      timestamp: "2026-03-14T06:00:10.000Z",
    },
    activeSkillIds: ["skill_1"],
    modelId: "gemini-2.5-pro",
  });

  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.session.messages.length, 4);
  assert.equal(finalized.session.messages.at(-1)?.content, "answer");
  assert.deepEqual(finalized.session.active_skill_ids, ["skill_1"]);
  assert.deepEqual(readSessionTurnMarkers(finalized.session.metadata), []);
  assert.deepEqual(readRecentCompletedEventIds(finalized.session.metadata), ["event_done"]);

  const completedReplay = await beginSessionTurn({
    supabase,
    session: readSession(),
    eventId: "event_done",
    userMessage,
    modelId: "gemini-2.5-pro",
  });

  assert.equal(completedReplay.status, "already_completed");
  assert.equal(readSession().messages.length, 4);
});

test("finalizeSessionTurn clears markers without appending assistant when assistantMessage is null", async () => {
  const initialSession = makeSession({
    messages: makeMessages(2),
    version: 1,
  });
  const { supabase } = createSessionSupabase(initialSession);
  const userMessage: ChatMessage = {
    role: "user",
    content: "room turn",
    timestamp: "2026-03-14T07:00:00.000Z",
  };

  const begun = await beginSessionTurn({
    supabase,
    session: initialSession,
    eventId: "event_room",
    userMessage,
    modelId: "gemini-2.5-pro",
  });
  const finalized = await finalizeSessionTurn({
    supabase,
    session: begun.session,
    eventId: "event_room",
    assistantMessage: null,
    activeSkillIds: [],
    modelId: "gemini-2.5-pro",
  });

  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.session.messages.length, 3);
  assert.equal(finalized.session.messages.at(-1)?.content, "room turn");
  assert.deepEqual(readSessionTurnMarkers(finalized.session.metadata), []);
  assert.deepEqual(readRecentCompletedEventIds(finalized.session.metadata), ["event_room"]);
});
