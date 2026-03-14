import { handleAsr } from "./handlers/asr";
import { handleCancel } from "./handlers/cancel";
import { handleHelp } from "./handlers/help";
import { handleLive } from "./handlers/live";
import { handleNew } from "./handlers/new";
import { handleRoom } from "./handlers/room";
import { handleSkill } from "./handlers/skill";
import { handleStart } from "./handlers/start";
import { handleStatus } from "./handlers/status";
import { handleTts } from "./handlers/tts";
import { handleWhoami } from "./handlers/whoami";
import type { CommandContext, LoopResult } from "./types";

export function parseCommand(messageText: string): { command: string | null } {
  if (messageText.startsWith("/")) {
    return { command: messageText.split(/[\s@]/)[0]?.toLowerCase() ?? null };
  }
  if (messageText.startsWith("!")) {
    const raw = messageText.slice(1).split(/[\s@]/)[0]?.toLowerCase();
    return { command: raw ? `/${raw}` : null };
  }
  return { command: null };
}

type DispatchContext = Omit<CommandContext, "command"> & { command?: string | null };

type CommandHandler = (ctx: CommandContext) => Promise<LoopResult | null>;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  "/new": handleNew,
  "/skill": handleSkill,
  "/help": handleHelp,
  "/status": handleStatus,
  "/whoami": handleWhoami,
  "/start": handleStart,
  "/tts": handleTts,
  "/live": handleLive,
  "/asr": handleAsr,
  "/room": handleRoom,
  "/cancel": handleCancel,
};

export async function dispatchCommand(ctx: DispatchContext): Promise<LoopResult | null> {
  const command = ctx.command ?? parseCommand(ctx.messageText).command;
  if (!command) return null;
  const handler = COMMAND_HANDLERS[command];
  if (!handler) return null;
  return handler({ ...ctx, command });
}

