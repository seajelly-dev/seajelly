import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { getModel } from "./provider";
import { createAgentTools } from "./tools";
import { AGENT_LIMITS } from "./limits";
import { getBotForAgent } from "@/lib/telegram/bot";
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

    const messageText = (event.payload as Record<string, unknown>).message
      ? (
          (event.payload as Record<string, unknown>).message as Record<
            string,
            unknown
          >
        ).text as string
      : "";
    if (!messageText) throw new Error("No message text in payload");

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

    const history: ChatMessage[] = Array.isArray(session.messages)
      ? (session.messages as ChatMessage[])
      : [];

    const messages: ModelMessage[] = history
      .slice(-AGENT_LIMITS.MAX_SESSION_MESSAGES)
      .map((m: ChatMessage) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    messages.push({ role: "user" as const, content: messageText });

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

    const updatedMessages: ChatMessage[] = [
      ...history,
      {
        role: "user" as const,
        content: messageText,
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
