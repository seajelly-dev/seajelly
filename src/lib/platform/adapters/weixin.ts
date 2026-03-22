import { GATEWAY_CAPABILITIES } from "@/lib/gateway/capabilities";
import { getGatewayConnection, postGatewayRoute } from "@/lib/gateway/client";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

export class WeixinAdapter implements PlatformSender {
  readonly platform = "weixin";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    const gateway = await getGatewayConnection();
    if (!gateway) {
      throw new Error("Edge Gateway not configured — required for WeChat iLink channel");
    }

    const resp = await postGatewayRoute(
      GATEWAY_CAPABILITIES.weixinReply,
      { user_id: chatId, text },
      { connection: gateway },
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`WeChat iLink reply failed (${resp.status}): ${body}`);
    }
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    const plain = md
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\((.+?)\)/g, "$1: $2");
    await this.sendText(chatId, plain);
  }

  async sendTyping(chatId: string): Promise<void> {
    const gateway = await getGatewayConnection();
    if (!gateway) return;

    await postGatewayRoute(
      GATEWAY_CAPABILITIES.weixinTyping,
      { user_id: chatId, status: 1 },
      { connection: gateway },
    ).catch(() => {});
  }

  async sendVoice(chatId: string, _audio: Buffer, _filename?: string): Promise<void> {
    await this.sendText(chatId, "[Voice message — not yet supported on WeChat iLink]");
  }

  async sendPhoto(chatId: string, _photo: Buffer, caption?: string): Promise<void> {
    await this.sendText(chatId, caption || "[Image — media upload not yet supported on WeChat iLink]");
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    _options?: SendOptions,
  ): Promise<void> {
    const btnText = buttons
      .flat()
      .map((btn) => `[${btn.label}]`)
      .join(" ");
    await this.sendText(chatId, `${text}\n\n${btnText}`);
  }
}
