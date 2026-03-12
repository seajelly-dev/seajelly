import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
}

const credCache = new Map<string, { creds: WhatsAppCredentials; expiresAt: number }>();

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function resolveWhatsAppCredentials(agentId: string): Promise<WhatsAppCredentials> {
  const cached = credCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.creds;

  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "whatsapp");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.access_token || !map.phone_number_id) {
    throw new Error(`Missing WhatsApp credentials for agent ${agentId}`);
  }
  const creds = { accessToken: map.access_token, phoneNumberId: map.phone_number_id };
  credCache.set(agentId, { creds, expiresAt: Date.now() + 300_000 });
  return creds;
}

const GRAPH_API = "https://graph.facebook.com/v21.0";

async function graphPost(
  creds: WhatsAppCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${GRAPH_API}/${creds.phoneNumberId}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.error) {
    console.error("WhatsApp API error:", path, JSON.stringify(data.error));
  }
  return data;
}

async function uploadMedia(
  creds: WhatsAppCredentials,
  buf: Buffer,
  mimeType: string,
  filename: string,
): Promise<string | null> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(buf)], { type: mimeType }), filename);

  const resp = await fetch(`${GRAPH_API}/${creds.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    body: form,
  });
  const data = await resp.json();
  if (data.error) {
    console.error("WhatsApp media upload error:", JSON.stringify(data.error));
    return null;
  }
  return data.id || null;
}

export class WhatsAppAdapter implements PlatformSender {
  readonly platform = "whatsapp";
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async sendText(chatId: string, text: string, _options?: SendOptions): Promise<void> {
    const creds = await resolveWhatsAppCredentials(this.agentId);
    await graphPost(creds, "/messages", {
      messaging_product: "whatsapp",
      to: chatId,
      type: "text",
      text: { body: text },
    });
  }

  async sendMarkdown(chatId: string, md: string): Promise<void> {
    // WhatsApp supports *bold*, _italic_, ~strikethrough~, ```monospace``` natively
    await this.sendText(chatId, md);
  }

  async sendTyping(_chatId: string): Promise<void> {
    // WhatsApp has no typing indicator via Cloud API
  }

  async sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void> {
    const creds = await resolveWhatsAppCredentials(this.agentId);
    const mediaId = await uploadMedia(creds, audio, "audio/ogg; codecs=opus", filename || "voice.ogg");
    if (!mediaId) {
      await this.sendText(chatId, "[语音发送失败]");
      return;
    }
    await graphPost(creds, "/messages", {
      messaging_product: "whatsapp",
      to: chatId,
      type: "audio",
      audio: { id: mediaId },
    });
  }

  async sendPhoto(chatId: string, photo: Buffer, caption?: string): Promise<void> {
    const creds = await resolveWhatsAppCredentials(this.agentId);
    const mediaId = await uploadMedia(creds, photo, "image/png", "photo.png");
    if (!mediaId) {
      await this.sendText(chatId, caption || "[Image]");
      return;
    }
    await graphPost(creds, "/messages", {
      messaging_product: "whatsapp",
      to: chatId,
      type: "image",
      image: { id: mediaId, ...(caption ? { caption } : {}) },
    });
  }

  async sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    _options?: SendOptions,
  ): Promise<void> {
    const creds = await resolveWhatsAppCredentials(this.agentId);
    const flat = buttons.flat().slice(0, 3); // WhatsApp max 3 buttons
    await graphPost(creds, "/messages", {
      messaging_product: "whatsapp",
      to: chatId,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: text.replace(/[*_`\[\]]/g, "").substring(0, 1024) },
        action: {
          buttons: flat.map((btn, i) => ({
            type: "reply",
            reply: {
              id: btn.callbackData.substring(0, 256),
              title: btn.label.substring(0, 20),
            },
          })),
        },
      },
    });
  }
}
