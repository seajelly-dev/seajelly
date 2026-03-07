import type { BotCommand } from "grammy/types";

export const BOT_COMMANDS: BotCommand[] = [
  { command: "new", description: "Start a new session (clear history)" },
  { command: "switch", description: "Switch to a different agent" },
  { command: "whoami", description: "Show your channel info and soul" },
  { command: "status", description: "Show current agent and session status" },
  { command: "help", description: "Show available commands" },
];
