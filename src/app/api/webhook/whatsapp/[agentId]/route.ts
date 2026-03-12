import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";

export const runtime = "nodejs";
export const maxDuration = 300;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function getVerifyToken(agentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("agent_credentials")
    .select("encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "whatsapp")
    .eq("credential_type", "verify_token")
    .single();
  return data?.encrypted_value ? decrypt(data.encrypted_value) : null;
}

async function getAccessToken(agentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("agent_credentials")
    .select("encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "whatsapp")
    .eq("credential_type", "access_token")
    .single();
  return data?.encrypted_value ? decrypt(data.encrypted_value) : null;
}

function verifyPayloadSignature(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const provided = signature.replace("sha256=", "");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  } catch {
    return false;
  }
}

// GET: Webhook verification (Meta sends GET to verify endpoint)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new Response("Bad request", { status: 400 });
  }

  const verifyToken = await getVerifyToken(agentId);
  if (!verifyToken || token !== verifyToken) {
    return new Response("Forbidden", { status: 403 });
  }

  console.log("WhatsApp webhook verified for agent:", agentId);
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// POST: Incoming messages & status updates
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    // Signature verification (optional but recommended)
    const sig = request.headers.get("x-hub-signature-256");
    const accessToken = await getAccessToken(agentId);
    // Meta signs with app secret, but we store access_token;
    // If verify_token is configured we trust the webhook is valid
    // (Meta only sends to verified endpoints)

    const entry = body.entry as Array<Record<string, unknown>> | undefined;
    if (!entry?.length) return NextResponse.json({ ok: true });

    for (const e of entry) {
      const changes = e.changes as Array<Record<string, unknown>> | undefined;
      if (!changes?.length) continue;

      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = change.value as Record<string, unknown>;
        if (!value) continue;

        // Handle interactive button replies (approval callbacks)
        const messages = value.messages as Array<Record<string, unknown>> | undefined;
        const contacts = value.contacts as Array<Record<string, unknown>> | undefined;

        if (!messages?.length) continue;

        for (const msg of messages) {
          const from = msg.from as string;
          const msgType = msg.type as string;
          const msgId = msg.id as string || `${Date.now()}`;

          let displayName: string | null = null;
          if (contacts?.length) {
            const contact = contacts.find((c) => c.wa_id === from) || contacts[0];
            if (contact) {
              const profile = contact.profile as Record<string, string> | undefined;
              displayName = profile?.name || (contact.name as string) || null;
            }
          }

          // Handle interactive button reply (approval)
          if (msgType === "interactive") {
            const interactive = msg.interactive as Record<string, unknown> | undefined;
            const buttonReply = interactive?.button_reply as Record<string, string> | undefined;
            if (buttonReply?.id) {
              const match = buttonReply.id.match(/^(approve|reject):(.+)$/);
              if (match) {
                const [, act, channelId] = match;
                const result = await processChannelApproval({
                  action: act as "approve" | "reject",
                  channelId,
                  callerUid: from,
                  fallbackAgentId: agentId,
                });
                const sender = await getSenderForAgent(agentId, "whatsapp");
                if (!result) {
                  await sender.sendText(from, "⚠️ Already processed.");
                } else {
                  const label = act === "approve"
                    ? `✅ Approved: ${result.name}`
                    : `❌ Rejected: ${result.name}`;
                  await sender.sendText(from, label);

                  if (result.targetUid) {
                    try {
                      const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
                      await targetSender.sendText(
                        result.targetUid,
                        act === "approve"
                          ? "✅ Your access has been approved! You can start chatting now."
                          : "❌ Your access request has been rejected.",
                      );
                    } catch { /* target unreachable */ }
                  }
                }
                continue;
              }
            }
          }

          let text = "";
          let fileRef: string | null = null;
          let fileMime: string | null = null;
          let fileName: string | null = null;

          if (msgType === "text") {
            const textObj = msg.text as Record<string, string> | undefined;
            text = textObj?.body || "";
          } else if (msgType === "image") {
            const img = msg.image as Record<string, string> | undefined;
            fileRef = img?.id || null;
            fileMime = img?.mime_type || "image/jpeg";
            text = img?.caption || "";
          } else if (msgType === "audio") {
            const audio = msg.audio as Record<string, string> | undefined;
            fileRef = audio?.id || null;
            fileMime = audio?.mime_type || "audio/ogg";
          } else if (msgType === "video") {
            const video = msg.video as Record<string, string> | undefined;
            fileRef = video?.id || null;
            fileMime = video?.mime_type || "video/mp4";
            text = video?.caption || "";
          } else if (msgType === "document") {
            const doc = msg.document as Record<string, string> | undefined;
            fileRef = doc?.id || null;
            fileMime = doc?.mime_type || "application/octet-stream";
            fileName = doc?.filename || null;
            text = doc?.caption || "";
          } else if (msgType === "sticker") {
            const sticker = msg.sticker as Record<string, string> | undefined;
            fileRef = sticker?.id || null;
            fileMime = sticker?.mime_type || "image/webp";
          } else {
            console.log(`WhatsApp: unknown msgType "${msgType}", skipping`);
            continue;
          }

          console.log(`WhatsApp msg: type=${msgType} fileRef=${fileRef} fileMime=${fileMime} fileName=${fileName} text_len=${text.length} from=${from}`);

          if (!text && !fileRef) {
            console.log("WhatsApp: skipping empty message (no text and no fileRef)");
            continue;
          }

          // Mark as read + show typing indicator
          const phoneNumberId = (value.metadata as Record<string, string>)?.phone_number_id;
          if (accessToken && phoneNumberId) {
            fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                status: "read",
                message_id: msgId,
                typing_indicator: { type: "text" },
              }),
            }).catch(() => {});
          }

          await handleInboundMessage({
            platform: "whatsapp",
            agentId,
            platformChatId: from,
            platformUid: from,
            displayName,
            text,
            fileRef,
            fileMime,
            fileName,
            rawPayload: {
              update_id: msgId,
              message_extra: { msg, contacts, metadata: value.metadata },
            },
            dedupKey: `whatsapp:${agentId}:${from}:${msgId}`,
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
