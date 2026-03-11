import { Bot } from "grammy";
import { InputFile } from "grammy";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

const botCache = new Map<string, Bot>();

async function resolveBot(agentId: string): Promise<Bot> {
  const cached = botCache.get(agentId);
  if (cached) return cached;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: cred } = await supabase
    .from("agent_credentials")
    .select("encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "telegram")
    .eq("credential_type", "bot_token")
    .single();

  let token: string | null = null;
  if (cred?.encrypted_value) {
    token = decrypt(cred.encrypted_value);
  }

  if (!token) {
    const { data: agent } = await supabase
      .from("agents")
      .select("telegram_bot_token")
      .eq("id", agentId)
      .single();
    if (!agent?.telegram_bot_token) {
      throw new Error(`No Telegram bot token for agent ${agentId}`);
    }
    token = decrypt(agent.telegram_bot_token);
  }

  const bot = new Bot(token);
  botCache.set(agentId, bot);
  return bot;
}

export function resetTelegramBot(agentId: string) {
  botCache.delete(agentId);
}

export function resetAllTelegramBots() {
  botCache.clear();
}

export class TelegramAdapter implements PlatformSender {
  readonly platform = "telegram";
  private agentId: string;
  private bot: Bot | null = null;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  private async getBot(): Promise<Bot> {
    if (!this.bot) {
      this.bot = await resolveBot(this.agentId);
    }
    return this.bot;
  }

  private tgId(chatId: string): number {
    return Number(chatId);
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<void> {
    const bot = await this.getBot();
    const opts: Record<string, unknown> = {};
    if (options?.parseMode && options.parseMode !== "plain") {
      opts.parse_mode = options.parseMode;
    }
    await bot.api.sendMessage(this.tgId(chatId), text, opts);
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    const bot = await this.getBot();
    try {
      await bot.api.sendMessage(this.tgId(chatId), md, { parse_mode: "Markdown" });
    } catch {
      await bot.api.sendMessage(this.tgId(chatId), md);
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    const bot = await this.getBot();
    await bot.api.sendChatAction(this.tgId(chatId), "typing").catch(() => {});
  }

  async sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void> {
    const bot = await this.getBot();
    await bot.api.sendVoice(this.tgId(chatId), new InputFile(audio, filename || "voice.wav"));
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    options?: SendOptions,
  ): Promise<void> {
    const bot = await this.getBot();
    const inlineKeyboard = buttons.map((row) =>
      row.map((btn) => ({ text: btn.label, callback_data: btn.callbackData })),
    );
    const markup = { reply_markup: { inline_keyboard: inlineKeyboard } };
    if (options?.parseMode && options.parseMode !== "plain") {
      try {
        await bot.api.sendMessage(this.tgId(chatId), text, { ...markup, parse_mode: options.parseMode });
        return;
      } catch {
        // fallback to plain text if markdown parsing fails
      }
    }
    await bot.api.sendMessage(this.tgId(chatId), text.replace(/[*_`\[\]]/g, ""), markup);
  }
}
