import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { getModel } from "./provider";
import { createAgentTools } from "./tools";
import { AGENT_LIMITS } from "./limits";
import { getBotForAgent } from "@/lib/telegram/bot";
import { downloadTelegramPhoto } from "@/lib/telegram/photo";
import { connectMCPServers, type MCPResult } from "@/lib/mcp/client";
import type { Agent, AgentEvent, ChatMessage, Channel } from "@/types/database";

interface LoopResult {
  success: boolean;
  reply?: string;
  error?: string;
  traceId: string;
}

export async function runAgentLoop(event: AgentEvent): Promise<LoopResult> {
  const traceId = event.trace_id;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const startTime = Date.now();
  let mcpResult: MCPResult | null = null;

  try {
    if (!event.agent_id) {
      throw new Error("No agent_id on event");
    }

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("*")
      .eq("id", event.agent_id)
      .single();

    if (agentErr || !agent) {
      throw new Error(`Agent not found: ${event.agent_id}`);
    }

    const typedAgent = agent as Agent;
    const chatId = event.chat_id;
    if (!chatId) throw new Error("No chat_id on event");

    const msgPayload = (event.payload as Record<string, unknown>).message as
      | Record<string, unknown>
      | undefined;
    const messageText = (msgPayload?.text as string) || "";
    const photoFileId = (msgPayload?.photo_file_id as string) || null;

    if (!messageText && !photoFileId) {
      throw new Error("No message text or image in payload");
    }

    const command = messageText.startsWith("/")
      ? messageText.split(/[\s@]/)[0].toLowerCase()
      : null;

    // ── Resolve channel from event payload ──
    const platformUid =
      ((event.payload as Record<string, unknown>).platform_uid as string) ||
      null;

    let channel: Channel | null = null;
    if (platformUid) {
      const { data: existingChannel } = await supabase
        .from("channels")
        .select("*")
        .eq("agent_id", typedAgent.id)
        .eq("platform", "telegram")
        .eq("platform_uid", platformUid)
        .single();

      if (existingChannel) {
        channel = existingChannel as Channel;
      } else if (typedAgent.access_mode !== "whitelist") {
        const fromData = (
          (event.payload as Record<string, unknown>).message as Record<
            string,
            unknown
          >
        ).from as Record<string, unknown> | undefined;

        const { data: newChannel } = await supabase
          .from("channels")
          .insert({
            agent_id: typedAgent.id,
            platform: "telegram",
            platform_uid: platformUid,
            display_name: (fromData?.first_name as string) || null,
            is_allowed: true,
          })
          .select()
          .single();

        channel = newChannel as Channel | null;
      }

      if (channel && !channel.is_allowed) {
        return { success: true, reply: "[blocked]", traceId };
      }
    }

    // ── Session ──
    let { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("chat_id", chatId)
      .eq("agent_id", typedAgent.id)
      .single();

    if (!session) {
      const { data: newSession, error: insertErr } = await supabase
        .from("sessions")
        .insert({
          chat_id: chatId,
          agent_id: typedAgent.id,
          channel_id: channel?.id || null,
          messages: [],
          version: 1,
        })
        .select()
        .single();

      if (insertErr || !newSession) {
        throw new Error(`Failed to create session: ${insertErr?.message}`);
      }
      session = newSession;
    } else if (channel && !session.channel_id) {
      await supabase
        .from("sessions")
        .update({ channel_id: channel.id })
        .eq("id", session.id);
    }

    const sessionVersion = session.version as number;

    // ── Handle bot commands (no AI needed) ──
    if (command) {
      const bot = await getBotForAgent(typedAgent.id);

      if (command === "/new") {
        await supabase
          .from("sessions")
          .update({ messages: [], version: sessionVersion + 1 })
          .eq("id", session.id);
        await bot.api.sendMessage(chatId, "✨ New session started.");
        return { success: true, reply: "✨ New session started.", traceId };
      }

      if (command === "/help") {
        const helpText =
          `📋 *${typedAgent.name} — Commands*\n\n` +
          "/new — Start a new session\n" +
          "/whoami — Show your identity profile\n" +
          "/status — Show session status\n" +
          "/help — Show this message\n\n" +
          "Send any text to chat.";
        await bot.api.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
        return { success: true, reply: helpText, traceId };
      }

      if (command === "/status") {
        const msgCount = Array.isArray(session.messages)
          ? (session.messages as unknown[]).length
          : 0;
        const statusText =
          `📊 *Status*\n\n` +
          `*Agent:* ${typedAgent.name}\n` +
          `*Model:* \`${typedAgent.model}\`\n` +
          `*Access Mode:* ${typedAgent.access_mode}\n` +
          `*Session Messages:* ${msgCount}`;
        await bot.api.sendMessage(chatId, statusText, { parse_mode: "Markdown" });
        return { success: true, reply: statusText, traceId };
      }

      if (command === "/whoami") {
        const whoamiText = channel
          ? `👤 *Who Am I*\n\n` +
            `*Platform UID:* \`${channel.platform_uid}\`\n` +
            `*Display Name:* ${channel.display_name || "N/A"}\n` +
            `*Allowed:* ${channel.is_allowed ? "✅" : "⛔"}\n\n` +
            `*User Soul:*\n${channel.user_soul || "(empty)"}`
          : "No channel record found.";
        await bot.api.sendMessage(chatId, whoamiText, { parse_mode: "Markdown" });
        return { success: true, reply: whoamiText, traceId };
      }

      if (command === "/start") {
        await bot.api.sendMessage(
          chatId,
          `👋 Hi! I'm *${typedAgent.name}*. Send me a message or type /help for commands.`,
          { parse_mode: "Markdown" }
        );
        return { success: true, reply: "start", traceId };
      }
    }

    const history: ChatMessage[] = Array.isArray(session.messages)
      ? (session.messages as ChatMessage[])
      : [];

    const messages: ModelMessage[] = history
      .slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES)
      .map((m: ChatMessage) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Build multimodal user message if image is present
    let imageDownloaded = false;
    if (photoFileId && event.agent_id) {
      const photo = await downloadTelegramPhoto(event.agent_id, photoFileId);
      if (photo) {
        imageDownloaded = true;
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "image"; image: string; mimeType: string }
        > = [];
        parts.push({
          type: "image",
          image: photo.base64,
          mimeType: photo.mimeType,
        });
        if (messageText) {
          parts.push({ type: "text", text: messageText });
        } else {
          parts.push({
            type: "text",
            text: "Please describe or analyze this image.",
          });
        }
        messages.push({
          role: "user" as const,
          content: parts,
        } as ModelMessage);
      }
    }
    if (!imageDownloaded) {
      messages.push({ role: "user" as const, content: messageText });
    }

    const model = await getModel(typedAgent.model);
    const builtinTools = createAgentTools({
      agentId: typedAgent.id,
      namespace: typedAgent.memory_namespace,
      channelId: channel?.id,
    });

    // ── MCP tools ──
    let tools = builtinTools;
    const mcpIds = typedAgent.mcp_server_ids ?? [];
    if (mcpIds.length > 0) {
      try {
        mcpResult = await connectMCPServers(mcpIds);
        tools = { ...builtinTools, ...mcpResult.tools } as typeof builtinTools;
      } catch (err) {
        console.warn("MCP tools loading failed, using builtin only:", err);
      }
    }

    // ── System prompt with soul injection ──
    let systemPrompt = typedAgent.system_prompt || "";
    if (typedAgent.ai_soul) {
      systemPrompt += `\n\n## Your Identity (AI Soul)\n${typedAgent.ai_soul}`;
    }
    if (channel?.user_soul) {
      systemPrompt += `\n\n## About This User\n${channel.user_soul}`;
    }

    // ── Skills injection ──
    const { data: agentSkillRows } = await supabase
      .from("agent_skills")
      .select("skill_id, skills(name, content)")
      .eq("agent_id", typedAgent.id);

    if (agentSkillRows?.length) {
      systemPrompt += "\n\n## Skills\n";
      for (const row of agentSkillRows) {
        const skill = row.skills as unknown as { name: string; content: string };
        if (skill) {
          systemPrompt += `\n### ${skill.name}\n${skill.content}\n`;
        }
      }
    }

    const deadline = startTime + AGENT_LIMITS.MAX_WALL_TIME_MS;
    const abortController = new AbortController();
    const timer = setTimeout(
      () => abortController.abort(),
      deadline - Date.now()
    );

    const bot = await getBotForAgent(typedAgent.id);
    await bot.api.sendChatAction(chatId, "typing").catch(() => {});
    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
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
        abortSignal: abortController.signal,
      });
    } finally {
      clearInterval(typingInterval);
      clearTimeout(timer);
    }

    const reply = result.text || "[No response generated]";

    await bot.api
      .sendMessage(chatId, reply, { parse_mode: "Markdown" })
      .catch(async () => {
        await bot.api.sendMessage(chatId, reply);
      });

    const userContent = imageDownloaded
      ? `[Image]${messageText ? ` ${messageText}` : ""}`
      : messageText;

    const updatedMessages: ChatMessage[] = [
      ...history,
      {
        role: "user" as const,
        content: userContent,
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant" as const,
        content: reply,
        timestamp: new Date().toISOString(),
      },
    ].slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES);

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({
        messages: updatedMessages,
        version: sessionVersion + 1,
      })
      .eq("id", session.id)
      .eq("version", sessionVersion);

    if (updateErr) {
      console.warn(
        `Session update conflict (trace: ${traceId}):`,
        updateErr.message
      );
    }

    if (mcpResult) await mcpResult.cleanup().catch(() => {});
    return { success: true, reply, traceId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Agent loop failed (trace: ${traceId}):`, errMsg);

    if (event.chat_id) {
      try {
        const bot = await getBotForAgent(event.agent_id!);
        await bot.api.sendMessage(
          event.chat_id,
          `Sorry, I encountered an error. Please try again later.`
        );
      } catch {
        // ignore send failure
      }
    }

    if (mcpResult) await mcpResult.cleanup().catch(() => {});
    return { success: false, error: errMsg, traceId };
  }
}
