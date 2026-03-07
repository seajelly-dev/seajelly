import { generateText } from "ai";
import { getModel } from "@/lib/agent/provider";
import { AGENT_LIMITS } from "@/lib/agent/limits";
import type { ChatMessage } from "@/types/database";

export function trimSessionMessages(
  messages: ChatMessage[],
  maxMessages = AGENT_LIMITS.MAX_SESSION_MESSAGES
): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}

export function shouldSummarize(messages: ChatMessage[]): boolean {
  return messages.length >= AGENT_LIMITS.SUMMARY_THRESHOLD;
}

export async function summarizeMessages(
  messages: ChatMessage[],
  modelId: string
): Promise<{ summary: string; remaining: ChatMessage[] }> {
  const toSummarize = messages.slice(0, -10);
  const remaining = messages.slice(-10);

  const conversationText = toSummarize
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const model = await getModel(modelId);

  const result = await generateText({
    model,
    system:
      "You are a conversation summarizer. Produce a concise summary of key topics, decisions, and user preferences from the conversation. Output only the summary, no preamble.",
    messages: [{ role: "user" as const, content: conversationText }],
    maxOutputTokens: 500,
  });

  return {
    summary: result.text,
    remaining: [
      {
        role: "system",
        content: `[Previous conversation summary]\n${result.text}`,
        timestamp: new Date().toISOString(),
      },
      ...remaining,
    ],
  };
}
