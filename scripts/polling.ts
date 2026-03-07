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
import type { ChatMessage } from "@/types/database";

config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.ENCRYPTION_KEY) {
  console.error("Missing env vars. Check .env.local has SUPABASE_SERVICE_ROLE_KEY and ENCRYPTION_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  console.log("Webhook cleared. Starting long polling...\n");

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const from = ctx.from;

    console.log(`[${new Date().toISOString()}] ${from?.first_name}: ${text}`);

    try {
      const { data: agent } = await supabase
        .from("agents")
        .select("*")
        .eq("is_default", true)
        .limit(1)
        .single();

      if (!agent) {
        await ctx.reply("No agent configured. Create one in the dashboard.");
        return;
      }

      let { data: session } = await supabase
        .from("sessions")
        .select("*")
        .eq("chat_id", chatId)
        .eq("agent_id", agent.id)
        .single();

      if (!session) {
        const { data: newSession } = await supabase
          .from("sessions")
          .insert({ chat_id: chatId, agent_id: agent.id, messages: [], version: 1 })
          .select()
          .single();
        session = newSession;
      }
      if (!session) {
        await ctx.reply("Failed to create session.");
        return;
      }

      const history: ChatMessage[] = Array.isArray(session.messages)
        ? (session.messages as ChatMessage[])
        : [];

      const messages = [
        ...history.slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      const model = await getModel(agent.model as string);
      const tools = createAgentTools(agent.id, (agent.memory_namespace as string) || "default");

      console.log(`  Calling ${agent.model}...`);

      const result = await generateText({
        model,
        system: (agent.system_prompt as string) || undefined,
        messages,
        tools,
        stopWhen: stepCountIs(AGENT_LIMITS.MAX_STEPS),
        maxOutputTokens: AGENT_LIMITS.MAX_TOKENS,
      });

      const reply = result.text || "[No response]";
      console.log(`  Reply: ${reply.slice(0, 120)}${reply.length > 120 ? "..." : ""}\n`);

      await ctx.reply(reply);

      const updatedMessages: ChatMessage[] = [
        ...history,
        { role: "user" as const, content: text, timestamp: new Date().toISOString() },
        { role: "assistant" as const, content: reply, timestamp: new Date().toISOString() },
      ].slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES);

      await supabase
        .from("sessions")
        .update({ messages: updatedMessages, version: (session.version as number) + 1 })
        .eq("id", session.id);

    } catch (err) {
      console.error("Error:", err);
      await ctx.reply("Sorry, something went wrong. Check the console.");
    }
  });

  bot.start({
    onStart: () => console.log("Polling started. Send a message to your bot!\n"),
  });

  process.on("SIGINT", () => {
    console.log("\nStopping bot...");
    bot.stop();
    process.exit(0);
  });
}

main().catch(console.error);
