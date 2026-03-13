import { WebClient } from "@slack/web-api";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface SlackCredentials {
  botToken: string;
  signingSecret: string;
}

const clientCache = new Map<string, WebClient>();

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function resolveSlackCredentials(agentId: string): Promise<SlackCredentials> {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "slack");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.bot_token || !map.signing_secret) {
    throw new Error(`Missing Slack credentials for agent ${agentId}`);
  }
  return { botToken: map.bot_token, signingSecret: map.signing_secret };
}

async function getClient(agentId: string): Promise<WebClient> {
  const cached = clientCache.get(agentId);
  if (cached) return cached;

  const creds = await resolveSlackCredentials(agentId);
  const client = new WebClient(creds.botToken);
  clientCache.set(agentId, client);
  return client;
}

export class SlackAdapter implements PlatformSender {
  readonly platform = "slack";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<void> {
    void options;
    const client = await getClient(this.agentId);
    await client.chat.postMessage({ channel: chatId, text });
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    const client = await getClient(this.agentId);
    await client.chat.postMessage({
      channel: chatId,
      text: md,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: md },
        },
      ],
    });
  }

  async sendTyping(chatId: string): Promise<void> {
    void chatId;
    // Slack has no public typing indicator API for bots
  }

  async sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void> {
    const client = await getClient(this.agentId);
    try {
      await client.filesUploadV2({
        channel_id: chatId,
        file: audio,
        filename: filename || "voice.wav",
        title: "Voice Message",
      });
    } catch {
      await this.sendText(chatId, "[语音发送失败]");
    }
  }

  async sendPhoto(chatId: string, photo: Buffer, caption?: string): Promise<void> {
    const client = await getClient(this.agentId);
    try {
      await client.filesUploadV2({
        channel_id: chatId,
        file: photo,
        filename: "chart.png",
        title: caption || "Image",
      });
    } catch {
      await this.sendText(chatId, caption || "[Image]");
    }
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    options?: SendOptions,
  ): Promise<void> {
    void options;
    const client = await getClient(this.agentId);
    const elements = buttons.flat().map((btn) => ({
      type: "button" as const,
      text: { type: "plain_text" as const, text: btn.label },
      action_id: btn.callbackData,
      value: btn.callbackData,
    }));
    await client.chat.postMessage({
      channel: chatId,
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
        {
          type: "actions",
          elements,
        },
      ],
    });
  }
}
