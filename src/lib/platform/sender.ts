import type { PlatformSender, PlatformFileDownloader } from "./types";
import { NullFileDownloader } from "./types";
import { TelegramAdapter } from "./adapters/telegram";
import { TelegramFileDownloader } from "./adapters/telegram-file";
import { FeishuAdapter } from "./adapters/feishu";
import { WeComAdapter } from "./adapters/wecom";
import { SlackAdapter } from "./adapters/slack";
import { QQBotAdapter } from "./adapters/qqbot";

export async function getSenderForAgent(
  agentId: string,
  platform: string,
): Promise<PlatformSender> {
  switch (platform) {
    case "telegram":
      return new TelegramAdapter(agentId);
    case "feishu":
      return new FeishuAdapter(agentId);
    case "wecom":
      return new WeComAdapter(agentId);
    case "slack":
      return new SlackAdapter(agentId);
    case "qqbot":
      return new QQBotAdapter(agentId);
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
