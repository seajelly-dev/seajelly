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
): Promise<Record<string, unknown>> {
  const token = await getTenantAccessToken(agentId);
  const resp = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return resp.json();
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

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    await feishuAPI(this.agentId, "/im/v1/messages", {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    });
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
    });
  }

  async sendTyping(_chatId: string): Promise<void> {
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
    });
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    _options?: SendOptions,
  ): Promise<void> {
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
    });
  }
}
