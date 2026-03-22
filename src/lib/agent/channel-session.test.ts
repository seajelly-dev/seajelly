import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceChannelAccess, findOrCreateActiveSession } from "@/lib/agent/channel-session";
import type { PlatformSender } from "@/lib/platform/types";
import type { Agent, Channel } from "@/types/database";

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

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "channel_1",
    agent_id: "agent_1",
    platform: "telegram",
    platform_uid: "user_1",
    display_name: "User",
    user_soul: "",
    is_allowed: true,
    is_owner: false,
    trial_used: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSender() {
  const sent: string[] = [];
  const sender: PlatformSender = {
    platform: "telegram",
    async sendText(_chatId, text) {
      sent.push(text);
    },
    async sendMarkdown() {},
    async sendTyping() {},
    async sendVoice() {},
    async sendPhoto() {},
    async sendInteractiveButtons() {},
  };
  return { sender, sent };
}

test("enforceChannelAccess blocks null channel when agent requires approval", async () => {
  const { sender } = makeSender();
  const result = await enforceChannelAccess({
    supabase: {} as SupabaseClient,
    agent: makeAgent({ access_mode: "approval" }),
    channel: null,
    sender,
    platformChatId: "chat_1",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reply, "[no_channel_created]");
});

test("enforceChannelAccess allows null channel when agent is open", async () => {
  const { sender } = makeSender();
  const result = await enforceChannelAccess({
    supabase: {} as SupabaseClient,
    agent: makeAgent({ access_mode: "open" }),
    channel: null,
    sender,
    platformChatId: "chat_1",
  });

  assert.equal(result.allowed, true);
});

test("enforceChannelAccess returns pending approval reply for disallowed channels", async () => {
  const { sender, sent } = makeSender();
  const result = await enforceChannelAccess({
    supabase: {} as SupabaseClient,
    agent: makeAgent({ access_mode: "approval" }),
    channel: makeChannel({ is_allowed: false }),
    sender,
    platformChatId: "chat_1",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reply, "[pending_approval]");
  assert.equal(sent.length, 1);
  assert.ok((sent[0] ?? "").length > 0);
});

test("findOrCreateActiveSession creates a session when none exists", async () => {
  const inserted: unknown[] = [];
  const supabase = {
    from(table: string) {
      if (table !== "sessions") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        single() {
                          return Promise.resolve({ data: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert(payload: unknown) {
          inserted.push(payload);
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "session_1",
                      platform_chat_id: "chat_1",
                      agent_id: "agent_1",
                      channel_id: "channel_1",
                      messages: [],
                      metadata: {},
                      active_skill_ids: [],
                      version: 1,
                      is_active: true,
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const session = await findOrCreateActiveSession({
    supabase,
    agentId: "agent_1",
    platformChatId: "chat_1",
    channel: makeChannel(),
  });

  assert.equal(session.id, "session_1");
  assert.equal(inserted.length, 1);
});

test("findOrCreateActiveSession throws when session insert fails", async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        single() {
                          return Promise.resolve({ data: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: null,
                    error: { message: "insert failed" },
                  });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    () =>
      findOrCreateActiveSession({
        supabase,
        agentId: "agent_1",
        platformChatId: "chat_1",
        channel: makeChannel(),
      }),
    /insert failed/,
  );
});

test("findOrCreateActiveSession backfills channel_id for existing session", async () => {
  const updates: unknown[] = [];
  const supabase = {
    from(table: string) {
      if (table !== "sessions") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        single() {
                          return Promise.resolve({
                            data: {
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
                            },
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(payload: unknown) {
          updates.push(payload);
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const session = await findOrCreateActiveSession({
    supabase,
    agentId: "agent_1",
    platformChatId: "chat_1",
    channel: makeChannel({ id: "channel_9" }),
  });

  assert.equal(session.id, "session_1");
  assert.deepEqual(updates, [{ channel_id: "channel_9" }]);
});
