import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface QQBotCredentials {
  appId: string;
  appSecret: string;
}

const QQ_API_BASE = "https://api.sgroup.qq.com";
const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

let tokenCache: { token: string; expiresAt: number; appId: string } | null = null;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function resolveQQBotCredentials(agentId: string): Promise<QQBotCredentials> {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "qqbot");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.app_id || !map.app_secret) {
    throw new Error(`Missing QQBot credentials for agent ${agentId}`);
  }
  return { appId: map.app_id, appSecret: map.app_secret };
}

async function getAccessToken(agentId: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const creds = await resolveQQBotCredentials(agentId);
  const res = await fetch(QQ_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: creds.appId, clientSecret: creds.appSecret }),
  });
  if (!res.ok) {
    throw new Error(`QQBot getAccessToken failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
    appId: creds.appId,
  };
  return data.access_token;
}

async function qqApiPost(
  agentId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = await getAccessToken(agentId);
  const res = await fetch(`${QQ_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QQBot API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * QQ Bot chatId format: "c2c:<user_openid>" | "group:<group_openid>"
 */
function parseChatId(chatId: string): { type: "c2c" | "group"; openid: string } {
  if (chatId.startsWith("group:")) {
    return { type: "group", openid: chatId.slice(6) };
  }
  return { type: "c2c", openid: chatId.replace(/^c2c:/, "") };
}

function getSendPath(target: { type: "c2c" | "group"; openid: string }): string {
  return target.type === "group"
    ? `/v2/groups/${target.openid}/messages`
    : `/v2/users/${target.openid}/messages`;
}

export class QQBotAdapter implements PlatformSender {
  readonly platform = "qqbot";
  private agentId: string;
  private replyCtx: { msgId?: string; eventId?: string } = {};

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  setReplyContext(msgId?: string, eventId?: string) {
    this.replyCtx = { msgId, eventId };
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    const target = parseChatId(chatId);
    const payload: Record<string, unknown> = { content: text, msg_type: 0 };
    if (this.replyCtx.msgId) {
      payload.msg_id = this.replyCtx.msgId;
    } else if (this.replyCtx.eventId) {
      payload.event_id = this.replyCtx.eventId;
    }
    await qqApiPost(this.agentId, getSendPath(target), payload);
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    const target = parseChatId(chatId);
    const payload: Record<string, unknown> = {
      msg_type: 2,
      markdown: { content: md },
    };
    if (this.replyCtx.msgId) {
      payload.msg_id = this.replyCtx.msgId;
    } else if (this.replyCtx.eventId) {
      payload.event_id = this.replyCtx.eventId;
    }
    try {
      await qqApiPost(this.agentId, getSendPath(target), payload);
    } catch {
      await this.sendText(chatId, md);
    }
  }

  async sendTyping(_chatId: string): Promise<void> {
    // QQ Bot API does not support typing indicators
  }

  async sendVoice(chatId: string, _audio: Buffer, _filename?: string): Promise<void> {
    await this.sendText(chatId, "[语音消息暂不支持]");
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    _options?: SendOptions,
  ): Promise<void> {
    const target = parseChatId(chatId);
    const rows = buttons.map((row) => ({
      buttons: row.map((btn) => ({
        id: btn.callbackData,
        render_data: { label: btn.label, visited_label: btn.label, style: 1 },
        action: {
          type: 2,
          permission: { type: 2 },
          data: btn.callbackData,
        },
      })),
    }));

    const payload: Record<string, unknown> = {
      msg_type: 2,
      markdown: { content: text },
      keyboard: { content: { rows } },
    };
    if (this.replyCtx.msgId) {
      payload.msg_id = this.replyCtx.msgId;
    } else if (this.replyCtx.eventId) {
      payload.event_id = this.replyCtx.eventId;
    }

    try {
      await qqApiPost(this.agentId, getSendPath(target), payload);
    } catch {
      await this.sendText(chatId, text);
    }
  }
}

/**
 * Ed25519 signature verification for QQ Bot webhook callbacks.
 * QQ Bot uses a deterministic Ed25519 keypair derived from the app secret.
 */
export async function verifyQQBotSignature(
  appSecret: string,
  timestamp: string,
  body: string,
  signatureHex: string,
): Promise<boolean> {
  const crypto = await import("crypto");
  const ed25519Seed = buildEd25519Seed(appSecret);

  try {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        ed25519Seed,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const publicKeyObj = crypto.createPublicKey(privateKey);
    const msg = Buffer.concat([
      Buffer.from(timestamp, "utf-8"),
      Buffer.from(body, "utf-8"),
    ]);
    const sig = Buffer.from(signatureHex, "hex");
    return crypto.verify(null, msg, publicKeyObj, sig);
  } catch {
    return false;
  }
}

function buildEd25519Seed(appSecret: string): Buffer {
  let seed = appSecret;
  while (seed.length < 32) seed = seed + seed;
  return Buffer.from(seed.slice(0, 32), "utf-8");
}

/**
 * Generate Ed25519 signature for QQ Bot webhook validation challenge.
 */
export function signQQBotChallenge(
  appSecret: string,
  eventTs: string,
  plainToken: string,
): string {
  const crypto = require("crypto") as typeof import("crypto");
  const ed25519Seed = buildEd25519Seed(appSecret);

  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      ed25519Seed,
    ]),
    format: "der",
    type: "pkcs8",
  });

  const msg = Buffer.concat([
    Buffer.from(eventTs, "utf-8"),
    Buffer.from(plainToken, "utf-8"),
  ]);
  const signature = crypto.sign(null, msg, privateKey);
  return signature.toString("hex");
}
