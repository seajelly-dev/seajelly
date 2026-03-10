import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface WeComCredentials {
  corpId: string;
  corpSecret: string;
  agentIdWeCom: string;
  token: string;
  encodingAesKey: string;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function resolveWeComCredentials(agentId: string): Promise<WeComCredentials> {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "wecom");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.corp_id || !map.corp_secret) {
    throw new Error(`Missing WeCom credentials for agent ${agentId}`);
  }
  return {
    corpId: map.corp_id,
    corpSecret: map.corp_secret,
    agentIdWeCom: map.agent_id || "",
    token: map.token || "",
    encodingAesKey: map.encoding_aes_key || "",
  };
}

async function getAccessToken(agentId: string): Promise<string> {
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const creds = await resolveWeComCredentials(agentId);
  const resp = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${creds.corpId}&corpsecret=${creds.corpSecret}`,
  );
  const data = await resp.json();
  if (data.errcode !== 0) {
    throw new Error(`WeCom token error: ${data.errmsg}`);
  }
  const token = data.access_token as string;
  tokenCache.set(agentId, { token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 });
  return token;
}

async function wecomSendMsg(
  agentId: string,
  toUser: string,
  body: Record<string, unknown>,
): Promise<void> {
  const token = await getAccessToken(agentId);
  const creds = await resolveWeComCredentials(agentId);
  await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      agentid: Number(creds.agentIdWeCom),
      ...body,
    }),
  });
}

// WeCom AES crypto utilities
export function decryptWeComMsg(
  encryptedMsg: string,
  encodingAesKey: string,
): string {
  const aesKey = Buffer.from(encodingAesKey + "=", "base64");
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encryptedMsg, "base64"), decipher.final()]);
  const padLen = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - padLen);
  const msgLen = decrypted.readUInt32BE(16);
  return decrypted.subarray(20, 20 + msgLen).toString("utf8");
}

export function verifyWeComSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(arr.join("")).digest("hex");
}

export class WeComAdapter implements PlatformSender {
  readonly platform = "wecom";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    await wecomSendMsg(this.agentId, chatId, {
      msgtype: "text",
      text: { content: text },
    });
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    await wecomSendMsg(this.agentId, chatId, {
      msgtype: "markdown",
      markdown: { content: md },
    });
  }

  async sendTyping(_chatId: string): Promise<void> {
    // WeCom does not have a reliable public typing indicator API
  }

  async sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void> {
    const token = await getAccessToken(this.agentId);
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(audio)]), filename || "voice.amr");
    const uploadResp = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=voice`,
      { method: "POST", body: form },
    );
    const uploadData = await uploadResp.json();
    if (uploadData.errcode) {
      await this.sendText(chatId, "[语音发送失败]");
      return;
    }
    await wecomSendMsg(this.agentId, chatId, {
      msgtype: "voice",
      voice: { media_id: uploadData.media_id },
    });
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    _options?: SendOptions,
  ): Promise<void> {
    const btnList = buttons.flat().map((btn) => ({
      type: 1,
      text: btn.label,
      style: 1,
      key: btn.callbackData,
    }));
    await wecomSendMsg(this.agentId, chatId, {
      msgtype: "template_card",
      template_card: {
        card_type: "button_interaction",
        main_title: { title: text },
        button_list: btnList,
      },
    });
  }
}
