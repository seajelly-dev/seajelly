import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { PlatformSender, SendOptions, ButtonRow } from "../types";

interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
}

const credCache = new Map<string, { creds: WhatsAppCredentials; expiresAt: number }>();
const typingContextCache = new Map<string, { messageId: string; updatedAt: number }>();
const TYPING_CONTEXT_TTL_MS = 15 * 60 * 1000;
let lastTypingContextPruneAt = 0;

type WhatsAppApiErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function parseErrorPayload(data: unknown): WhatsAppApiErrorPayload | null {
  if (!data || typeof data !== "object") return null;
  const err = (data as Record<string, unknown>).error;
  if (!err || typeof err !== "object") return null;
  return err as WhatsAppApiErrorPayload;
}

function isTokenExpiredError(err: WhatsAppApiErrorPayload): boolean {
  if (err.code === 190 && err.error_subcode === 463) return true;
  if (err.code === 190 && typeof err.message === "string" && /expired/i.test(err.message)) return true;
  return false;
}

function formatWhatsAppApiError(path: string, err: WhatsAppApiErrorPayload): string {
  const code = err.code ?? "unknown";
  const subcode = err.error_subcode ?? "unknown";
  const base = err.message || "Unknown WhatsApp API error";
  const tokenHint = isTokenExpiredError(err)
    ? " Access token is expired/invalid. Please update with a permanent System User token."
    : "";
  return `WhatsApp API ${path} failed: ${base} (code=${code}, subcode=${subcode}).${tokenHint}`;
}

async function readJsonSafe(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export function invalidateWhatsAppCache(agentId?: string): void {
  if (agentId) {
    credCache.delete(agentId);
    return;
  }
  credCache.clear();
}

function typingContextKey(agentId: string, chatId: string): string {
  return `${agentId}:${chatId}`;
}

function pruneTypingContextCache(now = Date.now()): void {
  if (now - lastTypingContextPruneAt < 60_000) return;
  lastTypingContextPruneAt = now;
  for (const [key, value] of typingContextCache.entries()) {
    if (now - value.updatedAt > TYPING_CONTEXT_TTL_MS) {
      typingContextCache.delete(key);
    }
  }
}

export function setWhatsAppTypingContext(agentId: string, chatId: string, messageId: string): void {
  if (!agentId || !chatId || !messageId) return;
  const now = Date.now();
  pruneTypingContextCache(now);
  typingContextCache.set(typingContextKey(agentId, chatId), {
    messageId,
    updatedAt: now,
  });
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

const GRAPH_API = "https://graph.facebook.com/v22.0";

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
  const data = await readJsonSafe(resp);
  const err = parseErrorPayload(data);
  if (err) {
    throw new Error(formatWhatsAppApiError(path, err));
  }
  if (!resp.ok) {
    const raw = typeof data.raw === "string" ? data.raw.substring(0, 300) : "";
    throw new Error(`WhatsApp API ${path} failed: HTTP ${resp.status} ${resp.statusText}${raw ? `, body=${raw}` : ""}`);
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
  const data = await readJsonSafe(resp);
  const err = parseErrorPayload(data);
  if (err) {
    if (isTokenExpiredError(err)) {
      throw new Error(formatWhatsAppApiError("/media", err));
    }
    console.error("WhatsApp media upload error:", formatWhatsAppApiError("/media", err));
    return null;
  }
  if (!resp.ok) {
    const raw = typeof data.raw === "string" ? data.raw.substring(0, 300) : "";
    console.error(`WhatsApp media upload failed: HTTP ${resp.status} ${resp.statusText}${raw ? `, body=${raw}` : ""}`);
    return null;
  }
  const mediaId = typeof data.id === "string" ? data.id : null;
  if (!mediaId) {
    console.error("WhatsApp media upload returned no media id");
    return null;
  }
  return mediaId;
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

  async sendTyping(chatId: string): Promise<void> {
    const now = Date.now();
    pruneTypingContextCache(now);
    const ctx = typingContextCache.get(typingContextKey(this.agentId, chatId));
    if (!ctx) return;
    if (now - ctx.updatedAt > TYPING_CONTEXT_TTL_MS) {
      typingContextCache.delete(typingContextKey(this.agentId, chatId));
      return;
    }
    try {
      const creds = await resolveWhatsAppCredentials(this.agentId);
      await graphPost(creds, "/messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: ctx.messageId,
        typing_indicator: { type: "text" },
      });
    } catch (err) {
      console.warn("WhatsApp sendTyping failed (ignored):", err);
    }
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
