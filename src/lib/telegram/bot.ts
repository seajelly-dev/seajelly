import { Bot } from "grammy";
import { decrypt } from "@/lib/crypto/encrypt";
import { createStrictServiceClient } from "@/lib/supabase/server";

const botCache = new Map<string, Bot>();

export function createTelegramBot(token: string) {
  return new Bot(token.trim());
}

export async function loadTelegramBotToken(agentId: string): Promise<string> {
  const db = createStrictServiceClient();
  const [{ data: cred }, { data: agent }] = await Promise.all([
    db
      .from("agent_credentials")
      .select("encrypted_value")
      .eq("agent_id", agentId)
      .eq("platform", "telegram")
      .eq("credential_type", "bot_token")
      .maybeSingle(),
    db.from("agents").select("telegram_bot_token").eq("id", agentId).maybeSingle(),
  ]);

  const encryptedValue = cred?.encrypted_value || agent?.telegram_bot_token;
  if (!encryptedValue) {
    throw new Error(`No Telegram bot token for agent ${agentId}`);
  }

  return decrypt(encryptedValue);
}

export async function getBotForAgent(agentId: string): Promise<Bot> {
  const cached = botCache.get(agentId);
  if (cached) return cached;

  const token = await loadTelegramBotToken(agentId);
  const bot = createTelegramBot(token);
  botCache.set(agentId, bot);
  return bot;
}

export function resetBotForAgent(agentId: string) {
  botCache.delete(agentId);
}

export function resetAllBots() {
  botCache.clear();
}
