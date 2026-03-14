import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAgentSystemPrompt,
  resolveAgentRuntimeContext,
  resolveSkillActivationPlan,
} from "@/lib/agent/runtime-context";
import type { ChatMessage } from "@/types/database";

test("resolveSkillActivationPlan backfills legacy sessions and activates matching skills", () => {
  const history: ChatMessage[] = [{ role: "user", content: "hello" }];
  const result = resolveSkillActivationPlan({
    allAgentSkills: [
      { id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" },
      { id: "s2", name: "Travel", description: "trip planning", content: "travel content" },
    ],
    sessionActiveSkillIds: [],
    history,
    messageText: "I need help with travel planning",
  });

  assert.equal(result.isLegacySession, true);
  assert.deepEqual(result.sessionActiveSkillIds, ["s1", "s2"]);
  assert.deepEqual(result.activeSkillIds, ["s1", "s2"]);
});

test("resolveSkillActivationPlan activates relevant inactive skills for current message", () => {
  const result = resolveSkillActivationPlan({
    allAgentSkills: [
      { id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" },
      { id: "s2", name: "Travel", description: "trip planning", content: "travel content" },
    ],
    sessionActiveSkillIds: ["s1"],
    history: [],
    messageText: "Need help with trip planning next week",
  });

  assert.equal(result.isLegacySession, false);
  assert.deepEqual(result.newlyActivatedIds, ["s2"]);
  assert.deepEqual(result.activeSkillIds, ["s1", "s2"]);
});

test("buildAgentSystemPrompt includes identity, memories, skills, summary, and tool policies", () => {
  const prompt = buildAgentSystemPrompt({
    basePrompt: "Base prompt",
    aiSoul: "Helpful assistant",
    userSoul: "Prefers concise replies",
    canEditAiSoul: false,
    memories: {
      channel: [{ category: "preference", content: "Likes tables" }],
      global: [{ category: "fact", content: "Product ships worldwide" }],
    },
    sessionSummarySection: "## Session Summary\nRecent work",
    activeSkills: [{ id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" }],
    inactiveSkills: [{ id: "s2", name: "Travel", description: "trip planning", content: "travel content" }],
    toolPolicySections: ["## Tool Policy\nUse tools honestly."],
  });

  assert.match(prompt, /Your Identity/);
  assert.match(prompt, /About This User/);
  assert.match(prompt, /Identity Protection/);
  assert.match(prompt, /## Memories/);
  assert.match(prompt, /## Session Summary/);
  assert.match(prompt, /## Active Skills/);
  assert.match(prompt, /## Available Skills/);
  assert.match(prompt, /## Tool Policy/);
});

test("resolveAgentRuntimeContext returns activeSkillIds without updating sessions", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  const calls: Array<{ table: string; op: string }> = [];
  const supabase = {
    from(table: string) {
      const immediateResult = () => {
        if (table === "agent_mcps") return Promise.resolve({ data: [] });
        if (table === "agent_sub_apps") return Promise.resolve({ data: [] });
        if (table === "agent_skills") {
          return Promise.resolve({
            data: [
              {
                skill_id: "skill_1",
                skills: {
                  id: "skill_1",
                  name: "Travel",
                  description: "trip planning",
                  content: "travel content",
                },
              },
            ],
          });
        }
        if (table === "channels") return Promise.resolve({ count: 0 });
        return Promise.resolve({ data: [] });
      };
      return {
        select() {
          calls.push({ table, op: "select" });
          return {
            eq() {
              if (table === "agent_mcps" || table === "agent_sub_apps" || table === "agent_skills" || table === "channels") {
                return immediateResult();
              }
              return this;
            },
            in() {
              return immediateResult();
            },
            order() {
              return this;
            },
            limit() {
              return immediateResult();
            },
          };
        },
        update() {
          calls.push({ table, op: "update" });
          throw new Error(`unexpected update on ${table}`);
        },
      };
    },
  } as unknown as SupabaseClient;

  try {
    const context = await resolveAgentRuntimeContext({
      supabase,
      agent: {
        id: "agent_1",
        name: "TestAgent",
        system_prompt: "",
        tools_config: {},
        memory_namespace: "default",
        model: "gpt-test",
        provider_id: null,
        is_default: false,
        access_mode: "open",
        ai_soul: "",
        telegram_bot_token: null,
        bot_locale: "en",
        created_at: new Date().toISOString(),
      },
      channel: null,
      sender: {
        platform: "telegram",
        async sendText() {},
        async sendMarkdown() {},
        async sendTyping() {},
        async sendVoice() {},
        async sendPhoto() {},
        async sendInteractiveButtons() {},
      },
      platformChatId: "chat_1",
      platform: "telegram",
      locale: "en",
      traceId: "trace_1",
      sessionActiveSkillIds: [],
      history: [{ role: "user", content: "hello" }],
      messageText: "Need help with trip planning",
      sessionSummary: null,
      toolsConfig: {},
      hasEmbeddingApiKey: false,
      hasImageInput: false,
      configuredKnowledgeEmbedModel: null,
    });

    assert.deepEqual(context.activeSkillIds, ["skill_1"]);
    assert.ok(calls.every((call) => !(call.table === "sessions" && call.op === "update")));
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnon;
  }
});
