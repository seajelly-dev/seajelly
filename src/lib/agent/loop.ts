import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { getModel } from "./provider";
import { createAgentTools } from "./tools";
import { AGENT_LIMITS } from "./limits";
import { getBot } from "@/lib/telegram/bot";
import type { Agent, AgentEvent, ChatMessage } from "@/types/database";

interface LoopResult {
  success: boolean;
  reply?: string;
  error?: string;
  traceId: string;
}

export async function runAgentLoop(event: AgentEvent): Promise<LoopResult> {
  const traceId = event.trace_id;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const startTime = Date.now();

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
      ? ((event.payload as Record<string, unknown>).message as Record<string, unknown>).text as string
      : "";
    if (!messageText) throw new Error("No message text in payload");

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
          messages: [],
          version: 1,
        })
        .select()
        .single();

      if (insertErr || !newSession) {
        throw new Error(`Failed to create session: ${insertErr?.message}`);
      }
      session = newSession;
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
    const tools = createAgentTools(typedAgent.id, typedAgent.memory_namespace);

    const deadline = startTime + AGENT_LIMITS.MAX_WALL_TIME_MS;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), deadline - Date.now());

    let result;
    try {
      result = await generateText({
        model,
        system: typedAgent.system_prompt || undefined,
        messages,
        tools,
        stopWhen: stepCountIs(AGENT_LIMITS.MAX_STEPS),
        maxOutputTokens: AGENT_LIMITS.MAX_TOKENS,
        abortSignal: abortController.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const reply = result.text || "[No response generated]";

    const bot = await getBot();
    await bot.api.sendMessage(chatId, reply, { parse_mode: "Markdown" }).catch(async () => {
      await bot.api.sendMessage(chatId, reply);
    });

    const updatedMessages: ChatMessage[] = [
      ...history,
      { role: "user" as const, content: messageText, timestamp: new Date().toISOString() },
      { role: "assistant" as const, content: reply, timestamp: new Date().toISOString() },
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
      console.warn(`Session update conflict (trace: ${traceId}):`, updateErr.message);
    }

    return { success: true, reply, traceId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Agent loop failed (trace: ${traceId}):`, errMsg);

    if (event.chat_id) {
      try {
        const bot = await getBot();
        await bot.api.sendMessage(
          event.chat_id,
          `Sorry, I encountered an error. Please try again later.`
        );
      } catch {
        // ignore send failure
      }
    }

    return { success: false, error: errMsg, traceId };
  }
}
