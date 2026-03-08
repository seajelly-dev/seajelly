/**
 * Local development Telegram polling.
 * Starts one grammY Bot instance per agent that has a telegram_bot_token.
 *
 * Usage: pnpm run dev:bot
 */

import { Bot } from "grammy";
import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { generateText, stepCountIs } from "ai";
import { decrypt } from "@/lib/crypto/encrypt";
import { getModel } from "@/lib/agent/provider";
import { createAgentTools } from "@/lib/agent/tools";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import { BOT_COMMANDS } from "@/lib/telegram/commands";
import { connectMCPServers, type MCPResult } from "@/lib/mcp/client";
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
const bots: Bot[] = [];

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

interface AgentRow {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  memory_namespace: string;
  access_mode: string;
  ai_soul: string;
  telegram_bot_token: string;
  tools_config: Record<string, unknown> | null;
}

async function startBotForAgent(agent: AgentRow) {
  const token = decrypt(agent.telegram_bot_token);
  const bot = new Bot(token);
  const me = await bot.api.getMe();

  console.log(`  🤖 ${agent.name} → @${me.username} (${me.first_name})`);

  await bot.api.deleteWebhook();
  await bot.api.setMyCommands(BOT_COMMANDS);

  // ── /help ──
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📋 *${agent.name} — Commands*\n\n` +
        "/new — Start a new session\n" +
        "/whoami — Show your identity profile\n" +
        "/status — Show session status\n" +
        "/help — Show this message\n\n" +
        "Send any text to chat.",
      { parse_mode: "Markdown" }
    );
  });

  // ── /whoami ──
  bot.command("whoami", async (ctx) => {
    const platformUid = String(ctx.from?.id);
    const { data: channel } = await supabase
      .from("channels")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("platform", "telegram")
      .eq("platform_uid", platformUid)
      .single();

    if (!channel) {
      await ctx.reply("No channel record found.");
      return;
    }

    await ctx.reply(
      `👤 *Who Am I*\n\n` +
        `*Platform UID:* \`${channel.platform_uid}\`\n` +
        `*Display Name:* ${channel.display_name || "N/A"}\n` +
        `*Allowed:* ${channel.is_allowed ? "✅" : "⛔"}\n\n` +
        `*User Soul:*\n${channel.user_soul || "(empty)"}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /status ──
  bot.command("status", async (ctx) => {
    const platformChatId = String(ctx.chat.id);
    const { data: session } = await supabase
      .from("sessions")
      .select("id, messages, version")
      .eq("platform_chat_id", platformChatId)
      .eq("agent_id", agent.id)
      .eq("is_active", true)
      .single();

    const msgCount =
      session && Array.isArray(session.messages)
        ? (session.messages as unknown[]).length
        : 0;

    await ctx.reply(
      `📊 *Status*\n\n` +
        `*Agent:* ${agent.name}\n` +
        `*Model:* \`${agent.model}\`\n` +
        `*Access Mode:* ${agent.access_mode}\n` +
        `*Session Messages:* ${msgCount}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /new ──
  bot.command("new", async (ctx) => {
    const platformChatId = String(ctx.chat.id);
    await supabase
      .from("sessions")
      .update({ is_active: false })
      .eq("platform_chat_id", platformChatId)
      .eq("agent_id", agent.id)
      .eq("is_active", true);

    await supabase.from("sessions").insert({
      platform_chat_id: platformChatId,
      agent_id: agent.id,
      messages: [],
      version: 1,
      is_active: true,
    });

    console.log(
      `[${new Date().toISOString()}] [${agent.name}] /new from ${ctx.from?.first_name}`
    );
    await ctx.reply("✨ New session started.");
  });

  type ChatAction = "typing" | "upload_photo" | "record_video" | "upload_video" | "record_voice" | "upload_voice" | "upload_document" | "choose_sticker" | "find_location" | "record_video_note" | "upload_video_note";

  async function handleMessage(
    ctx: { chat: { id: number }; from: { id: number; first_name: string }; reply: (text: string) => Promise<unknown>; replyWithChatAction: (action: ChatAction) => Promise<unknown> },
    text: string,
    photoFileId: string | null
  ) {
    const chatId = ctx.chat.id;
    const from = ctx.from;
    const platformUid = String(from.id);

    console.log(
      `[${new Date().toISOString()}] [${agent.name}] ${from?.first_name}: ${photoFileId ? "[Image] " : ""}${text}`
    );

    try {
      const channel = await resolveChannel(
        agent.id,
        agent.access_mode,
        platformUid,
        from.first_name || "Unknown"
      );

      if (!channel) {
        await ctx.reply("⛔ Access denied. Contact the admin.");
        return;
      }
      if (!channel.is_allowed) {
        await ctx.reply("⛔ Your access has been revoked.");
        return;
      }

      const platformChatId = String(chatId);

      let { data: session } = await supabase
        .from("sessions")
        .select("*")
        .eq("platform_chat_id", platformChatId)
        .eq("agent_id", agent.id)
        .eq("is_active", true)
        .single();

      if (!session) {
        const { data: newSession } = await supabase
          .from("sessions")
          .insert({
            platform_chat_id: platformChatId,
            agent_id: agent.id,
            channel_id: channel.id,
            messages: [],
            version: 1,
            is_active: true,
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

      type MsgPart =
        | { type: "text"; text: string }
        | { type: "image"; image: string; mimeType: string };

      const messages = [
        ...history
          .slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
      ];

      let imageDownloaded = false;
      if (photoFileId) {
        try {
          const botToken = decrypt(agent.telegram_bot_token);
          const fileRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getFile?file_id=${photoFileId}`
          );
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result.file_path) {
            const dlUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
            const imgRes = await fetch(dlUrl);
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const ext = fileData.result.file_path.split(".").pop()?.toLowerCase() || "jpg";
              const mimeMap: Record<string, string> = {
                jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
                gif: "image/gif", webp: "image/webp",
              };
              const parts: MsgPart[] = [
                { type: "image", image: buf.toString("base64"), mimeType: mimeMap[ext] || "image/jpeg" },
                { type: "text", text: text || "Please describe or analyze this image." },
              ];
              messages.push({ role: "user" as const, content: parts } as never);
              imageDownloaded = true;
            }
          }
        } catch (err) {
          console.warn("Photo download failed:", err);
        }
      }
      if (!imageDownloaded) {
        messages.push({ role: "user" as const, content: text });
      }

      const model = await getModel(agent.model);
      const builtinTools = createAgentTools({
        agentId: agent.id,
        namespace: agent.memory_namespace || "default",
        channelId: channel.id,
      });

      const TOOL_DEFAULTS: Record<string, boolean> = {
        run_sql: false,
        schedule_task: true,
        cancel_scheduled_job: true,
        list_scheduled_jobs: true,
      };
      const toolsConfig = (agent.tools_config ?? {}) as Record<string, boolean>;
      const filteredBuiltin: typeof builtinTools = {} as typeof builtinTools;
      for (const [name, def] of Object.entries(builtinTools)) {
        if (name in TOOL_DEFAULTS) {
          const enabled = toolsConfig[name] ?? TOOL_DEFAULTS[name];
          if (enabled) {
            (filteredBuiltin as Record<string, unknown>)[name] = def;
          }
        } else {
          (filteredBuiltin as Record<string, unknown>)[name] = def;
        }
      }

      let mcpResult: MCPResult | null = null;
      let tools = filteredBuiltin;
      const { data: mcpRows } = await supabase
        .from("agent_mcps")
        .select("mcp_server_id")
        .eq("agent_id", agent.id);
      const mcpIds = (mcpRows ?? []).map((r: { mcp_server_id: string }) => r.mcp_server_id);
      if (mcpIds.length > 0) {
        try {
          mcpResult = await connectMCPServers(mcpIds);
          tools = { ...filteredBuiltin, ...mcpResult.tools } as typeof filteredBuiltin;
        } catch (err) {
          console.warn("MCP tools loading failed:", err);
        }
      }

      let systemPrompt = agent.system_prompt || "";
      if (agent.ai_soul) {
        systemPrompt += `\n\n## Your Identity (AI Soul)\n${agent.ai_soul}`;
      }
      if (channel.user_soul) {
        systemPrompt += `\n\n## About This User\n${channel.user_soul}`;
      }

      const { data: agentSkillRows } = await supabase
        .from("agent_skills")
        .select("skill_id, skills(name, content)")
        .eq("agent_id", agent.id);

      if (agentSkillRows?.length) {
        systemPrompt += "\n\n## Skills\n";
        for (const row of agentSkillRows) {
          const skill = row.skills as unknown as { name: string; content: string };
          if (skill) {
            systemPrompt += `\n### ${skill.name}\n${skill.content}\n`;
          }
        }
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
        if (mcpResult) await mcpResult.cleanup().catch(() => {});
      }

      const reply = result.text || "[No response]";
      console.log(
        `  Reply: ${reply.slice(0, 120)}${reply.length > 120 ? "..." : ""}\n`
      );

      await ctx.reply(reply);

      const userContent = imageDownloaded
        ? `[Image]${text ? ` ${text}` : ""}`
        : text;

      const updatedMessages: ChatMessage[] = [
        ...history,
        { role: "user" as const, content: userContent, timestamp: new Date().toISOString() },
        { role: "assistant" as const, content: reply, timestamp: new Date().toISOString() },
      ].slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES);

      await supabase
        .from("sessions")
        .update({
          messages: updatedMessages,
          version: (session.version as number) + 1,
        })
        .eq("id", session.id);
    } catch (err) {
      console.error(`[${agent.name}] Error:`, err);
      await ctx.reply("Sorry, something went wrong.");
    }
  }

  // Text messages
  bot.on("message:text", async (ctx) => {
    await handleMessage(ctx, ctx.message.text, null);
  });

  // Photo messages
  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const caption = ctx.message.caption || "";
    await handleMessage(ctx, caption, fileId);
  });

  // Document (image files sent as documents)
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return;
    const caption = ctx.message.caption || "";
    await handleMessage(ctx, caption, doc.file_id);
  });

  bot.start({
    onStart: () => console.log(`  ✅ ${agent.name} polling started`),
  });

  bots.push(bot);
}

async function main() {
  console.log("Loading agents with Telegram bot tokens...\n");

  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, name, model, system_prompt, memory_namespace, access_mode, ai_soul, telegram_bot_token")
    .not("telegram_bot_token", "is", null);

  if (error) {
    console.error("Failed to load agents:", error.message);
    process.exit(1);
  }

  if (!agents || agents.length === 0) {
    console.error(
      "No agents with Telegram bot tokens found.\n" +
        "Go to Dashboard → Agents → Edit and add a Telegram Bot Token."
    );
    process.exit(1);
  }

  console.log(`Found ${agents.length} agent(s) with bot tokens:\n`);

  for (const agent of agents) {
    try {
      await startBotForAgent(agent as AgentRow);
    } catch (err) {
      console.error(`  ❌ Failed to start ${agent.name}:`, err instanceof Error ? err.message : err);
    }
  }

  if (bots.length === 0) {
    console.error("\nNo bots started successfully.");
    process.exit(1);
  }

  console.log(`\n🦀 ${bots.length} bot(s) running. Send messages to test!\n`);

  process.on("SIGINT", () => {
    console.log("\nStopping all bots...");
    for (const b of bots) b.stop();
    process.exit(0);
  });
}

main().catch(console.error);
