import type { PlatformSender, PlatformFileDownloader } from "./types";
import { NullFileDownloader } from "./types";
import { TelegramAdapter } from "./adapters/telegram";
import { TelegramFileDownloader } from "./adapters/telegram-file";

export async function getSenderForAgent(
  agentId: string,
  platform: string,
): Promise<PlatformSender> {
  switch (platform) {
    case "telegram":
      return new TelegramAdapter(agentId);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function getFileDownloader(platform: string): PlatformFileDownloader {
  switch (platform) {
    case "telegram":
      return new TelegramFileDownloader();
    default:
      return new NullFileDownloader();
  }
}
