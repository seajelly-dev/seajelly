import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function resolveCredentials(agentId: string): Promise<FeishuCredentials> {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "feishu");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.app_id || !map.app_secret) {
    throw new Error(`Missing Feishu credentials for agent ${agentId}`);
  }
  return { appId: map.app_id, appSecret: map.app_secret };
}

async function getTenantAccessToken(agentId: string): Promise<string> {
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const creds = await resolveCredentials(agentId);
  const resp = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
    },
  );
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Feishu token error: ${data.msg}`);
  }
  const token = data.tenant_access_token as string;
  tokenCache.set(agentId, { token, expiresAt: Date.now() + (data.expire - 300) * 1000 });
  return token;
}

async function feishuAPI(
  agentId: string,
  path: string,
  body: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const token = await getTenantAccessToken(agentId);
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const resp = await fetch(`https://open.feishu.cn/open-apis${path}${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json() as Record<string, unknown>;
  if (data.code && data.code !== 0) {
    console.error("Feishu API error:", path, data.code, data.msg);
  }
  return data;
}

export async function getFeishuUserName(agentId: string, openId: string, chatId?: string): Promise<string | null> {
  const token = await getTenantAccessToken(agentId);

  // Strategy 1: contact API (requires contact:user.base:readonly scope)
  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await resp.json();
    const user = data.data?.user;
    if (user?.name) return user.name;
    if (user?.en_name) return user.en_name;
  } catch { /* continue to fallback */ }

  // Strategy 2: chat members API (works when bot is in the chat)
  if (chatId) {
    try {
      const resp = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await resp.json();
      const members = data.data?.items as Array<{ member_id: string; name?: string }> | undefined;
      if (members) {
        const match = members.find((m) => m.member_id === openId);
        if (match?.name) return match.name;
      }
    } catch { /* continue to fallback */ }
  }

  // Strategy 3: bot chat info (for p2p chats)
  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/chats?user_id_type=open_id&page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await resp.json();
    const chats = data.data?.items as Array<{ chat_id: string; name?: string; chat_type?: string }> | undefined;
    if (chats) {
      const match = chats.find((c) => c.chat_id === chatId && c.chat_type === "p2p");
      if (match?.name) return match.name;
    }
  } catch { /* give up */ }

  return null;
}

function mdToFeishuPost(md: string): Record<string, unknown>[][] {
  return md.split("\n").map((line) => [{ tag: "text", text: line }]);
}

export class FeishuAdapter implements PlatformSender {
  readonly platform = "feishu";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  private ridType(chatId: string): string {
    return chatId.startsWith("oc_") ? "chat_id" : "open_id";
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<void> {
    void options;
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }, { receive_id_type: this.ridType(chatId) });
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    const content = {
      zh_cn: {
        title: "",
        content: mdToFeishuPost(md),
      },
    };
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "post",
      content: JSON.stringify(content),
    }, { receive_id_type: this.ridType(chatId) });
  }

  async sendTyping(chatId: string): Promise<void> {
    void chatId;
    // Feishu has no typing indicator API
  }

  async sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void> {
    const token = await getTenantAccessToken(this.agentId);
    const form = new FormData();
    form.append("file_type", "opus");
    form.append("file_name", filename || "voice.opus");
    form.append("file", new Blob([new Uint8Array(audio)]), filename || "voice.opus");
    const uploadResp = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const uploadData = await uploadResp.json();
    if (uploadData.code !== 0) {
      await this.sendText(chatId, "[语音发送失败]");
      return;
    }
    const fileKey = uploadData.data?.file_key;
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "audio",
      content: JSON.stringify({ file_key: fileKey }),
    }, { receive_id_type: this.ridType(chatId) });
  }

  async sendPhoto(chatId: string, photo: Buffer, caption?: string): Promise<void> {
    const token = await getTenantAccessToken(this.agentId);
    const form = new FormData();
    form.append("image_type", "message");
    form.append("image", new Blob([new Uint8Array(photo)]), "chart.png");
    const uploadResp = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const uploadData = await uploadResp.json();
    if (uploadData.code !== 0) {
      await this.sendText(chatId, caption || "[Image]");
      return;
    }
    const imageKey = uploadData.data?.image_key;
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    }, { receive_id_type: this.ridType(chatId) });
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    options?: SendOptions,
  ): Promise<void> {
    void options;
    const actions = buttons.flat().map((btn) => ({
      tag: "button",
      text: { tag: "plain_text", content: btn.label },
      value: { action: btn.callbackData },
      type: "primary",
    }));
    const card = {
      config: { wide_screen_mode: true },
      elements: [
        { tag: "div", text: { tag: "plain_text", content: text } },
        { tag: "action", actions },
      ],
    };
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }, { receive_id_type: this.ridType(chatId) });
  }
}
