import { NextResponse } from "next/server";
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { resolveSlackCredentials } from "@/lib/platform/adapters/slack";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval, getAgentLocale } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";
import { botT, getBotLocaleOrDefault, buildWelcomeText } from "@/lib/i18n/bot";

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

  const msg = payload.message as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, string> | undefined;
  const channelIdSlack = channel?.id;
  const ts = msg?.ts as string | undefined;

  const rawLocale = await getAgentLocale(agentId);
  const locale = getBotLocaleOrDefault(rawLocale);

  if (!result) {
    if (channelIdSlack && ts) {
      try {
        const creds = await resolveSlackCredentials(agentId);
        const client = new WebClient(creds.botToken);
        const alreadyText = botT(locale, "alreadyProcessedDot");
        await client.chat.update({
          channel: channelIdSlack,
          ts,
          text: alreadyText,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: alreadyText } }],
        });
      } catch { /* best effort */ }
    }
    return;
  }

  if (channelIdSlack && ts) {
    try {
      const creds = await resolveSlackCredentials(agentId);
      const client = new WebClient(creds.botToken);
      const label = act === "approve"
        ? botT(locale, "approved", { name: result.name })
        : botT(locale, "rejected", { name: result.name });
      await client.chat.update({
        channel: channelIdSlack,
        ts,
        text: label,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: label } }],
      });
    } catch { /* best effort */ }
  }

  if (result.targetUid) {
    try {
      const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
      await targetSender.sendText(
        result.targetUid,
        act === "approve"
          ? botT(locale, "accessApproved")
          : botT(locale, "accessRejected"),
      );
      if (act === "approve") {
        const { createClient } = await import("@supabase/supabase-js");
        const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
        const { data: aRow } = await supa.from("agents").select("name").eq("id", result.agentId).single();
        const agentName = (aRow as { name?: string } | null)?.name || "Agent";
        await targetSender.sendMarkdown(result.targetUid, buildWelcomeText(locale, agentName, result.targetPlatform));
      }
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
      const rawBody = await request.text();

      const timestamp = request.headers.get("x-slack-request-timestamp") || "";
      const signature = request.headers.get("x-slack-signature") || "";
      const creds = await resolveSlackCredentials(agentId);
      const valid = await verifySlackRequest(rawBody, timestamp, signature, creds.signingSecret);
      if (!valid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }

      const params = new URLSearchParams(rawBody);
      const payloadStr = params.get("payload");
      if (!payloadStr) return NextResponse.json({ ok: true });

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

    let displayName: string | null = null;
    if (user) {
      try {
        const client = new WebClient(creds.botToken);
        const info = await client.users.info({ user });
        const profile = info.user?.profile;
        displayName =
          profile?.display_name ||
          profile?.real_name ||
          info.user?.real_name ||
          info.user?.name ||
          null;
      } catch { /* non-critical */ }
    }

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
      displayName,
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
