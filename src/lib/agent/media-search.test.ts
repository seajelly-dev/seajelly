import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runImageKnowledgeBypass } from "@/lib/agent/media-search";

function makeSupabase() {
  const inserts: unknown[] = [];
  const supabase = {
    from(table: string) {
      if (table !== "agent_step_logs") throw new Error(`unexpected table ${table}`);
      return {
        insert(payload: unknown) {
          inserts.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, inserts };
}

function makeParams(overrides: Partial<Parameters<typeof runImageKnowledgeBypass>[0]> = {}) {
  const { supabase, inserts } = makeSupabase();
  return {
    params: {
      supabase,
      traceId: "trace_1",
      eventId: "event_1",
      agentId: "agent_1",
      channelId: "channel_1",
      sessionId: "session_1",
      imageBase64ForMediaSearch: "aGVsbG8=",
      imageMimeForMediaSearch: "image/png",
      imageUrlForMediaSearch: null,
      hasImageInput: true,
      hasEmbeddingApiKey: true,
      canImageKnowledgeSearchByModel: true,
      tools: { knowledge_search: {} },
      trimPayload: (input: unknown) => input,
      ...overrides,
    },
    inserts,
  };
}

test("runImageKnowledgeBypass skips unsupported mime from normalizer", async () => {
  const { params, inserts } = makeParams({
    deps: {
      normalizeImageForEmbedding: async () => null,
    },
  });

  const result = await runImageKnowledgeBypass(params);

  assert.equal(result.promptAppendix, "");
  assert.equal(inserts.length, 1);
  assert.match(JSON.stringify(inserts[0]), /skipped_unsupported_mime/);
});

test("runImageKnowledgeBypass skips oversized normalized images", async () => {
  const hugeBase64 = "a".repeat(12 * 1024 * 1024);
  const { params, inserts } = makeParams({
    deps: {
      normalizeImageForEmbedding: async () => ({
        base64: hugeBase64,
        mimeType: "image/png",
        converted: false,
      }),
    },
  });

  const result = await runImageKnowledgeBypass(params);

  assert.equal(result.promptAppendix, "");
  assert.equal(inserts.length, 1);
  assert.match(JSON.stringify(inserts[0]), /skipped_too_large/);
});

test("runImageKnowledgeBypass skips when agent has no media embeddings", async () => {
  const { params, inserts } = makeParams({
    deps: {
      normalizeImageForEmbedding: async () => ({
        base64: "aGVsbG8=",
        mimeType: "image/png",
        converted: false,
      }),
      hasAgentMediaEmbeddings: async () => false,
      getMediaMatchThreshold: async () => 0.8,
      getAgentKnowledgeBaseIds: async () => [],
      searchArticleByMedia: async () => null,
    },
  });

  const result = await runImageKnowledgeBypass(params);

  assert.equal(result.promptAppendix, "");
  assert.equal(inserts.length, 1);
  assert.match(JSON.stringify(inserts[0]), /skipped_no_media_embeddings/);
});

test("runImageKnowledgeBypass records embedding failure when query embedding is null", async () => {
  const { params, inserts } = makeParams({
    deps: {
      normalizeImageForEmbedding: async () => ({
        base64: "aGVsbG8=",
        mimeType: "image/png",
        converted: false,
      }),
      hasAgentMediaEmbeddings: async () => true,
      getMediaMatchThreshold: async () => 0.8,
      embedContent: async () => null,
      getAgentKnowledgeBaseIds: async () => ["kb_1"],
      searchArticleByMedia: async () => null,
    },
  });

  const result = await runImageKnowledgeBypass(params);

  assert.equal(result.promptAppendix, "");
  assert.equal(inserts.length, 1);
  assert.match(JSON.stringify(inserts[0]), /query_embedding_failed/);
});

