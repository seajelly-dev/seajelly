import type { BotCommand } from "grammy/types";
import { getBotCommands } from "@/lib/i18n/bot";

export const BOT_COMMANDS: BotCommand[] = getBotCommands("en");
