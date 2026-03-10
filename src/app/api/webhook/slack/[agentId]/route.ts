import { NextResponse } from "next/server";
import crypto from "crypto";
import { resolveSlackCredentials } from "@/lib/platform/adapters/slack";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";

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

async function handleInteraction(
  payload: Record<string, unknown>,
  agentId: string,
) {
  const actions = payload.actions as Array<Record<string, string>> | undefined;
  if (!actions?.length) return;

  const action = actions[0];
  const value = action.value || "";
  const match = value.match(/^(approve|reject):(.+)$/);
  if (!match) return;

  const [, act, channelId] = match;
  const user = payload.user as Record<string, string> | undefined;
  const callerUid = user?.id || "";

  const result = await processChannelApproval({
    action: act as "approve" | "reject",
    channelId,
    callerUid,
    fallbackAgentId: agentId,
  });
  if (!result) return;

  if (result.targetUid) {
    try {
      const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
      await targetSender.sendText(
        result.targetUid,
        act === "approve"
          ? "✅ Your access has been approved! You can start chatting now."
          : "❌ Your access request has been rejected.",
      );
    } catch { /* target user unreachable */ }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const payloadStr = formData.get("payload") as string | null;
      if (!payloadStr) return NextResponse.json({ ok: true });

      const timestamp = request.headers.get("x-slack-request-timestamp") || "";
      const signature = request.headers.get("x-slack-signature") || "";
      const rawBody = `payload=${encodeURIComponent(payloadStr)}`;
      const creds = await resolveSlackCredentials(agentId);
      const valid = await verifySlackRequest(rawBody, timestamp, signature, creds.signingSecret);
      if (!valid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }

      const payload = JSON.parse(payloadStr);
      if (payload.type === "block_actions") {
        await handleInteraction(payload, agentId);
      }
      return NextResponse.json({ ok: true });
    }

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
    if (!event || event.type !== "message") {
      return NextResponse.json({ ok: true });
    }

    const allowedSubtypes = new Set([undefined, "file_share", "me_message"]);
    if (!allowedSubtypes.has(event.subtype)) {
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
