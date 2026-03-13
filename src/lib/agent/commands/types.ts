import type { SupabaseClient } from "@supabase/supabase-js";
import type { botT as BotT } from "@/lib/i18n/bot";
import type { Locale } from "@/lib/i18n/types";
import type { PlatformSender } from "@/lib/platform/types";
import type { Agent, AgentEvent, Channel, Session } from "@/types/database";

export interface LoopResult {
  success: boolean;
  reply?: string;
  error?: string;
  traceId: string;
}

export type CommandT = (k: Parameters<typeof BotT>[1], p?: Parameters<typeof BotT>[2]) => string;

export interface CommandContext {
  supabase: SupabaseClient;
  sender: PlatformSender;
  platform: string;
  platformChatId: string;
  agent: Agent;
  channel: Channel | null;
  session: Session;
  locale: Locale;
  t: CommandT;
  traceId: string;
  messageText: string;
  event: AgentEvent;
  command: string | null;
}

