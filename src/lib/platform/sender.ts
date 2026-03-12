import type { PlatformSender, PlatformFileDownloader } from "./types";
import { NullFileDownloader } from "./types";
import { TelegramAdapter } from "./adapters/telegram";
import { TelegramFileDownloader } from "./adapters/telegram-file";
import { SlackFileDownloader } from "./adapters/slack-file";
import { FeishuFileDownloader } from "./adapters/feishu-file";
import { WeComFileDownloader } from "./adapters/wecom-file";
import { FeishuAdapter } from "./adapters/feishu";
import { WeComAdapter } from "./adapters/wecom";
import { SlackAdapter } from "./adapters/slack";
import { QQBotAdapter } from "./adapters/qqbot";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { WhatsAppFileDownloader } from "./adapters/whatsapp-file";

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
    case "whatsapp":
      return new WhatsAppAdapter(agentId);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function getFileDownloader(platform: string): PlatformFileDownloader {
  switch (platform) {
    case "telegram":
      return new TelegramFileDownloader();
    case "slack":
      return new SlackFileDownloader();
    case "feishu":
      return new FeishuFileDownloader();
    case "wecom":
      return new WeComFileDownloader();
    case "whatsapp":
      return new WhatsAppFileDownloader();
    default:
      return new NullFileDownloader();
  }
}
