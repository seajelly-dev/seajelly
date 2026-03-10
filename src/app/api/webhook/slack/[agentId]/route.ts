import { NextResponse } from "next/server";
import crypto from "crypto";
import { resolveSlackCredentials } from "@/lib/platform/adapters/slack";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

async function verifySlackRequest(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
): Promise<boolean> {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;
  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", signingSecret).update(baseString).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const timestamp = request.headers.get("x-slack-request-timestamp") || "";
    const signature = request.headers.get("x-slack-signature") || "";

    const creds = await resolveSlackCredentials(agentId);
    const valid = await verifySlackRequest(rawBody, timestamp, signature, creds.signingSecret);
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const event = body.event;
    if (!event || event.type !== "message" || event.subtype) {
      return NextResponse.json({ ok: true });
    }

    if (event.bot_id) {
      return NextResponse.json({ ok: true });
    }

    const text = event.text || "";
    const channel = event.channel;
    const user = event.user || null;
    const ts = event.ts || `${Date.now()}`;

    let fileRef: string | null = null;
    let fileMime: string | null = null;
    let fileName: string | null = null;
    if (event.files && event.files.length > 0) {
      const f = event.files[0];
      fileRef = f.url_private || f.id || null;
      fileMime = f.mimetype || null;
      fileName = f.name || null;
    }

    return handleInboundMessage({
      platform: "slack",
      agentId,
      platformChatId: channel,
      platformUid: user,
      displayName: null,
      text,
      fileRef,
      fileMime,
      fileName,
      rawPayload: {
        update_id: ts,
        message_extra: {
          ts,
          team: body.team_id,
          channel_type: event.channel_type,
        },
      },
      dedupKey: `slack:${agentId}:${channel}:${ts}`,
    });
  } catch (err) {
    console.error("Slack webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
