import { GATEWAY_CAPABILITIES } from "@/lib/gateway/capabilities";
import {
  getGatewayConnection,
  findGatewayCapability,
  buildGatewayRouteUrl,
  type GatewayConnection,
} from "@/lib/gateway/client";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

async function postBridgeSubpath(
  connection: GatewayConnection,
  bridgePath: string,
  subpath: string,
  body: unknown,
): Promise<Response> {
  const url = buildGatewayRouteUrl(connection.url, `${bridgePath}/${subpath}`);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Secret": connection.secret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function resolveBridge() {
  const connection = await getGatewayConnection();
  if (!connection) {
    throw new Error("Edge Gateway not configured — required for WeChat iLink channel");
  }
  const route = findGatewayCapability(connection.manifest, GATEWAY_CAPABILITIES.weixinBridge);
  if (!route) {
    throw new Error("WeChat iLink bridge not configured in Edge Gateway");
  }
  return { connection, bridgePath: route.path };
}

export class WeixinAdapter implements PlatformSender {
  readonly platform = "weixin";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    const { connection, bridgePath } = await resolveBridge();
    const resp = await postBridgeSubpath(connection, bridgePath, "reply", {
      user_id: chatId,
      text,
    });

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
    try {
      const { connection, bridgePath } = await resolveBridge();
      await postBridgeSubpath(connection, bridgePath, "typing", {
        user_id: chatId,
        status: 1,
      });
    } catch {
      // typing is best-effort
    }
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
