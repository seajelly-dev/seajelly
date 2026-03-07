import { Bot } from "grammy";
import { getSecret } from "@/lib/secrets";

let _bot: Bot | null = null;

export async function getBot(): Promise<Bot> {
  if (_bot) return _bot;

  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured in secrets");
  }

  _bot = new Bot(token);
  return _bot;
}

export function resetBot() {
  _bot = null;
}
