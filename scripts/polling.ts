/**
 * Local development Telegram polling.
 * Thin wrapper: grammY long polling → shared Agentic Loop.
 *
 * Usage: pnpm run dev:bot
 */

import { Bot } from "grammy";
import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { generateText, stepCountIs } from "ai";
import { getSecret } from "@/lib/secrets";
import { getModel } from "@/lib/agent/provider";
import { createAgentTools } from "@/lib/agent/tools";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import { BOT_COMMANDS } from "@/lib/telegram/commands";
import type { ChatMessage, Channel } from "@/types/database";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.ENCRYPTION_KEY) {
  console.error(
    "Missing env vars. Check .env.local has SUPABASE_SERVICE_ROLE_KEY and ENCRYPTION_KEY."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getDefaultAgent() {
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("is_default", true)
    .limit(1)
    .single();
  return data;
}

async function resolveChannel(
  agentId: string,
  accessMode: string,
  platformUid: string,
  displayName: string
): Promise<Channel | null> {
  const { data: existing } = await supabase
    .from("channels")
    .select("*")
    .eq("agent_id", agentId)
    .eq("platform", "telegram")
    .eq("platform_uid", platformUid)
    .single();

  if (existing) return existing as Channel;

  if (accessMode === "whitelist") return null;

  const { data: created } = await supabase
    .from("channels")
    .insert({
      agent_id: agentId,
      platform: "telegram",
      platform_uid: platformUid,
      display_name: displayName,
      is_allowed: true,
    })
    .select()
    .single();

  return created as Channel | null;
}

async function main() {
  console.log("Loading Telegram Bot Token...");
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN not found in secrets table.");
    process.exit(1);
  }

  const bot = new Bot(token);
  const me = await bot.api.getMe();
  console.log(`Bot: @${me.username} (${me.first_name})`);

  await bot.api.deleteWebhook();

  await bot.api.setMyCommands(BOT_COMMANDS);
  console.log("Bot commands registered. Starting long polling...\n");

  // ── /help command ──
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "📋 *Available Commands*\n\n" +
        "/new — Start a new session (clear conversation history)\n" +
        "/whoami — Show your channel info and soul profile\n" +
        "/status — Show current agent and session status\n" +
        "/help — Show this help message\n\n" +
        "Just send any text message to chat with the AI agent.",
      { parse_mode: "Markdown" }
    );
  });

  // ── /whoami command ──
  bot.command("whoami", async (ctx) => {
    const agent = await getDefaultAgent();
    if (!agent) {
      await ctx.reply("No agent configured.");
      return;
    }

    const platformUid = String(ctx.from?.id);
    const { data: channel } = await supabase
      .from("channels")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("platform", "telegram")
      .eq("platform_uid", platformUid)
      .single();

    if (!channel) {
      await ctx.reply("No channel record found for you.");
      return;
    }

    const userSoul = channel.user_soul || "(empty)";
    await ctx.reply(
      `👤 *Who Am I*\n\n` +
        `*Platform UID:* \`${channel.platform_uid}\`\n` +
        `*Display Name:* ${channel.display_name || "N/A"}\n` +
        `*Allowed:* ${channel.is_allowed ? "✅" : "⛔"}\n\n` +
        `*User Soul:*\n${userSoul}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /status command ──
  bot.command("status", async (ctx) => {
    const agent = await getDefaultAgent();
    if (!agent) {
      await ctx.reply("No agent configured.");
      return;
    }

    const chatId = ctx.chat.id;
    const { data: session } = await supabase
      .from("sessions")
      .select("id, messages, version, updated_at")
      .eq("chat_id", chatId)
      .eq("agent_id", agent.id)
      .single();

    const msgCount = session && Array.isArray(session.messages)
      ? (session.messages as unknown[]).length
      : 0;

    await ctx.reply(
      `📊 *Status*\n\n` +
        `*Agent:* ${agent.name}\n` +
        `*Model:* \`${agent.model}\`\n` +
        `*Access Mode:* ${agent.access_mode || "open"}\n` +
        `*Session Messages:* ${msgCount}\n` +
        `*Session Version:* ${session?.version ?? "N/A"}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /new command: reset session ──
  bot.command("new", async (ctx) => {
    const agent = await getDefaultAgent();
    if (!agent) {
      await ctx.reply("No agent configured.");
      return;
    }

    const chatId = ctx.chat.id;
    const { error } = await supabase
      .from("sessions")
      .update({ messages: [] })
      .eq("chat_id", chatId)
      .eq("agent_id", agent.id);

    if (error) {
      await ctx.reply("Failed to reset session.");
      return;
    }

    console.log(
      `[${new Date().toISOString()}] /new from ${ctx.from?.first_name} — session cleared`
    );
    await ctx.reply("✨ New session started. Previous conversation cleared.");
  });

  // ── message handler ──
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const from = ctx.from;
    const platformUid = String(from.id);

    console.log(`[${new Date().toISOString()}] ${from?.first_name}: ${text}`);

    try {
      const agent = await getDefaultAgent();
      if (!agent) {
        await ctx.reply("No agent configured. Create one in the dashboard.");
        return;
      }

      // ── Gateway: channel check ──
      const channel = await resolveChannel(
        agent.id,
        agent.access_mode || "open",
        platformUid,
        from.first_name || "Unknown"
      );

      if (!channel) {
        await ctx.reply("⛔ Access denied. Contact the admin to get whitelisted.");
        console.log(`  ⛔ Blocked: user ${platformUid} not in whitelist`);
        return;
      }

      if (!channel.is_allowed) {
        await ctx.reply("⛔ Your access has been revoked. Contact the admin.");
        console.log(`  ⛔ Blocked: user ${platformUid} is_allowed=false`);
        return;
      }

      // ── Session ──
      let { data: session } = await supabase
        .from("sessions")
        .select("*")
        .eq("chat_id", chatId)
        .eq("agent_id", agent.id)
        .single();

      if (!session) {
        const { data: newSession } = await supabase
          .from("sessions")
          .insert({
            chat_id: chatId,
            agent_id: agent.id,
            channel_id: channel.id,
            messages: [],
            version: 1,
          })
          .select()
          .single();
        session = newSession;
      } else if (!session.channel_id) {
        await supabase
          .from("sessions")
          .update({ channel_id: channel.id })
          .eq("id", session.id);
      }

      if (!session) {
        await ctx.reply("Failed to create session.");
        return;
      }

      const history: ChatMessage[] = Array.isArray(session.messages)
        ? (session.messages as ChatMessage[])
        : [];

      const messages = [
        ...history
          .slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        { role: "user" as const, content: text },
      ];

      const model = await getModel(agent.model as string);
      const tools = createAgentTools({
        agentId: agent.id,
        namespace: (agent.memory_namespace as string) || "default",
        channelId: channel.id,
      });

      // ── System prompt with soul injection ──
      let systemPrompt = (agent.system_prompt as string) || "";
      if (agent.ai_soul) {
        systemPrompt += `\n\n## Your Identity (AI Soul)\n${agent.ai_soul}`;
      }
      if (channel.user_soul) {
        systemPrompt += `\n\n## About This User\n${channel.user_soul}`;
      }

      console.log(`  Calling ${agent.model}...`);

      await ctx.replyWithChatAction("typing");
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);

      let result;
      try {
        result = await generateText({
          model,
          system: systemPrompt || undefined,
          messages,
          tools,
          stopWhen: stepCountIs(AGENT_LIMITS.MAX_STEPS),
          maxOutputTokens: AGENT_LIMITS.MAX_TOKENS,
        });
      } finally {
        clearInterval(typingInterval);
      }

      const reply = result.text || "[No response]";
      console.log(
        `  Reply: ${reply.slice(0, 120)}${reply.length > 120 ? "..." : ""}\n`
      );

      await ctx.reply(reply);

      const updatedMessages: ChatMessage[] = [
        ...history,
        {
          role: "user" as const,
          content: text,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant" as const,
          content: reply,
          timestamp: new Date().toISOString(),
        },
      ].slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES);

      await supabase
        .from("sessions")
        .update({
          messages: updatedMessages,
          version: (session.version as number) + 1,
        })
        .eq("id", session.id);
    } catch (err) {
      console.error("Error:", err);
      await ctx.reply("Sorry, something went wrong. Check the console.");
    }
  });

  bot.start({
    onStart: () =>
      console.log("Polling started. Send a message to your bot!\n"),
  });

  process.on("SIGINT", () => {
    console.log("\nStopping bot...");
    bot.stop();
    process.exit(0);
  });
}

main().catch(console.error);
