import type { BotCommand } from "grammy/types";

export const BOT_COMMANDS: BotCommand[] = [
  { command: "new", description: "Start a new session (clear history)" },
  { command: "switch", description: "Switch to a different agent" },
  { command: "whoami", description: "Show your channel info and soul" },
  { command: "status", description: "Show current agent and session status" },
  { command: "tts", description: "Toggle TTS text-to-speech (owner only)" },
  { command: "live", description: "Get a live voice chat link" },
  { command: "asr", description: "Get an ASR transcription link" },
  { command: "help", description: "Show available commands" },
];
