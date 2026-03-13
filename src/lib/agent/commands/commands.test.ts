import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/types";
import type { PlatformSender } from "@/lib/platform/types";
import { dispatchCommand, parseCommand } from "@/lib/agent/commands";
import type { CommandT } from "@/lib/agent/commands/types";
import type { Agent, AgentEvent, Session } from "@/types/database";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
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

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "event_1",
    source: "manual",
    agent_id: "agent_1",
    platform_chat_id: "chat_1",
    dedup_key: null,
    payload: {},
    status: "pending",
    locked_until: null,
    retry_count: 0,
    max_retries: 0,
    error_message: null,
    trace_id: "trace_1",
    created_at: new Date().toISOString(),
    processed_at: null,
    ...overrides,
  };
}

function makeTestT(): CommandT {
  return ((key: Parameters<CommandT>[0], params?: Parameters<CommandT>[1]) => {
    const safeKey = String(key);
    if (!params) return safeKey;
    const rendered = Object.entries(params as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(",");
    return `${safeKey}(${rendered})`;
  }) as CommandT;
}

test("parseCommand normalizes / and ! prefixes", () => {
  assert.equal(parseCommand("/help").command, "/help");
  assert.equal(parseCommand("/help@bot").command, "/help");
  assert.equal(parseCommand("!help").command, "/help");
  assert.equal(parseCommand("/HELP  foo").command, "/help");
});

test("dispatchCommand routes /start and returns a LoopResult", async () => {
  const sent: Array<{ kind: "md" | "text"; text: string }> = [];
  const sender: PlatformSender = {
    platform: "telegram",
    async sendText(_chatId, text) {
      sent.push({ kind: "text", text });
    },
    async sendMarkdown(_chatId, md) {
      sent.push({ kind: "md", text: md });
    },
    async sendTyping() {},
    async sendVoice() {},
    async sendPhoto() {},
    async sendInteractiveButtons() {},
  };

  const supabase = { from: () => { throw new Error("unexpected supabase call"); } } as unknown as SupabaseClient;
  const agent = makeAgent();
  const locale: Locale = "en";

  const result = await dispatchCommand({
    supabase,
    sender,
    platform: "telegram",
    platformChatId: "chat_1",
    agent,
    channel: null,
    session: makeSession(),
    locale,
    t: makeTestT(),
    traceId: "trace_1",
    messageText: "/start",
    event: makeEvent(),
  });

  assert.ok(result);
  assert.equal(result?.success, true);
  assert.equal(result?.traceId, "trace_1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, "md");
  assert.match(sent[0]?.text ?? "", /startGreeting/);
  assert.match(sent[0]?.text ?? "", /agentName=TestAgent/);
});

test("dispatchCommand routes /status and includes message count", async () => {
  const sent: Array<{ kind: "md" | "text"; text: string }> = [];
  const sender: PlatformSender = {
    platform: "telegram",
    async sendText(_chatId, text) {
      sent.push({ kind: "text", text });
    },
    async sendMarkdown(_chatId, md) {
      sent.push({ kind: "md", text: md });
    },
    async sendTyping() {},
    async sendVoice() {},
    async sendPhoto() {},
    async sendInteractiveButtons() {},
  };

  const supabase = { from: () => { throw new Error("unexpected supabase call"); } } as unknown as SupabaseClient;
  const agent = makeAgent();
  const session = makeSession({
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ],
  });

  const result = await dispatchCommand({
    supabase,
    sender,
    platform: "telegram",
    platformChatId: "chat_1",
    agent,
    channel: null,
    session,
    locale: "en",
    t: makeTestT(),
    traceId: "trace_1",
    messageText: "/status",
    event: makeEvent(),
  });

  assert.ok(result);
  assert.equal(result?.success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, "md");
  assert.match(sent[0]?.text ?? "", /statusMessages\(count=3\)/);
});
