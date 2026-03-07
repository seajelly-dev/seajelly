import { Bot } from "grammy";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

const botCache = new Map<string, Bot>();

export async function getBotForAgent(agentId: string): Promise<Bot> {
  const cached = botCache.get(agentId);
  if (cached) return cached;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from("agents")
    .select("telegram_bot_token")
    .eq("id", agentId)
    .single();

  if (error || !data?.telegram_bot_token) {
    throw new Error(`No Telegram bot token for agent ${agentId}`);
  }

  const token = decrypt(data.telegram_bot_token);
  const bot = new Bot(token);
  botCache.set(agentId, bot);
  return bot;
}

export function resetBotForAgent(agentId: string) {
  botCache.delete(agentId);
}

export function resetAllBots() {
  botCache.clear();
}
