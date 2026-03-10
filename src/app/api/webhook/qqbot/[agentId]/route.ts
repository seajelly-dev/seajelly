import { NextResponse } from "next/server";
import {
  verifyQQBotSignature,
  signQQBotChallenge,
  resolveQQBotCredentials,
} from "@/lib/platform/adapters/qqbot";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ status: "QQBot webhook endpoint active", method: "Use POST" });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const rawBody = await request.text();

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error("QQBot webhook: invalid JSON body");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    let creds: { appId: string; appSecret: string };
    try {
      creds = await resolveQQBotCredentials(agentId);
    } catch (credErr) {
      console.error("QQBot webhook: failed to resolve credentials:", credErr);
      return NextResponse.json({ error: "Credential error" }, { status: 500 });
    }

    // Op 13: webhook URL validation challenge
    if (body.op === 13) {
      try {
        const d = body.d as { plain_token: string; event_ts: string };
        const signature = signQQBotChallenge(creds.appSecret, d.event_ts, d.plain_token);
        const respBody = { plain_token: d.plain_token, signature };
        console.log(
          "QQBot webhook: challenge response for agent", agentId,
          "plain_token:", d.plain_token,
          "event_ts:", d.event_ts,
          "sig_len:", signature.length,
          "sig_prefix:", signature.slice(0, 16),
          "resp:", JSON.stringify(respBody),
        );
        return new Response(JSON.stringify(respBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (signErr) {
        console.error("QQBot webhook: challenge signing failed:", signErr);
        return new Response(JSON.stringify({ error: "Signing failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Verify Ed25519 signature for non-challenge requests
    const sigHex = request.headers.get("x-signature-ed25519") || "";
    const timestamp = request.headers.get("x-signature-timestamp") || "";
    if (sigHex && timestamp) {
      const valid = await verifyQQBotSignature(creds.appSecret, timestamp, rawBody, sigHex);
      if (!valid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    // Non-dispatch events: ACK
    if (body.op !== 0) {
      return NextResponse.json({ op: 12, d: null });
    }

    const eventType = body.t as string;
    const d = body.d as Record<string, unknown>;
    const eventId = body.id as string;

    let text = "";
    let platformChatId = "";
    let platformUid = "";

    if (eventType === "C2C_MESSAGE_CREATE") {
      // Single-chat message from user
      text = extractTextContent(d);
      platformUid = (d.author as Record<string, string>)?.user_openid || "";
      platformChatId = `c2c:${platformUid}`;
    } else if (eventType === "GROUP_AT_MESSAGE_CREATE") {
      // Group @bot message
      text = extractTextContent(d);
      const groupOpenid = (d.group_openid as string) || "";
      platformUid = (d.author as Record<string, string>)?.member_openid || "";
      platformChatId = `group:${groupOpenid}`;
    } else if (eventType === "AT_MESSAGE_CREATE" || eventType === "MESSAGE_CREATE") {
      // Guild channel message
      text = extractTextContent(d);
      const channelId = (d.channel_id as string) || "";
      platformUid = ((d.author as Record<string, string>)?.id) || "";
      platformChatId = `channel:${channelId}`;
    } else if (eventType === "DIRECT_MESSAGE_CREATE") {
      // Guild DM
      text = extractTextContent(d);
      const guildId = (d.guild_id as string) || "";
      platformUid = ((d.author as Record<string, string>)?.id) || "";
      platformChatId = `dm:${guildId}`;
    } else {
      // Other events we don't process
      return NextResponse.json({ op: 12, d: null });
    }

    if (!text.trim()) {
      return NextResponse.json({ op: 12, d: null });
    }

    const msgId = (d.id as string) || "";
    const displayName =
      ((d.author as Record<string, string>)?.username) || null;

    return handleInboundMessage({
      platform: "qqbot",
      agentId,
      platformChatId,
      platformUid,
      displayName,
      text: text.trim(),
      fileRef: null,
      fileMime: null,
      fileName: null,
      rawPayload: {
        update_id: eventId || `${Date.now()}`,
        message_extra: {
          event_type: eventType,
          msg_id: msgId,
          event_id: eventId,
        },
      },
      dedupKey: `qqbot:${agentId}:${platformChatId}:${msgId || eventId}`,
    });
  } catch (err) {
    console.error("QQBot webhook error:", err);
    return NextResponse.json({ op: 12, d: null });
  }
}

function extractTextContent(d: Record<string, unknown>): string {
  if (typeof d.content === "string") return d.content;
  return "";
}
