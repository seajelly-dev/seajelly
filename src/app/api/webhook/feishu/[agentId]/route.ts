import { NextResponse } from "next/server";
import crypto from "crypto";
import { CardActionHandler } from "@larksuiteoapi/node-sdk";
import { decrypt } from "@/lib/crypto/encrypt";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";
import { processChannelApproval, getAgentLocale } from "@/lib/platform/approval-core";
import { getSenderForAgent } from "@/lib/platform/sender";
import { getFeishuUserName } from "@/lib/platform/adapters/feishu";
import { botT, getBotLocaleOrDefault, buildWelcomeText } from "@/lib/i18n/bot";
import { createStrictServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function getSupabase() {
  return createStrictServiceClient();
}

function decryptFeishuEvent(encrypt: string, encryptKey: string): string {
  const buf = Buffer.from(encrypt, "base64");
  const keyHash = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = buf.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
  let decrypted = decipher.update(buf.subarray(16));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

function normalizeSecret(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeSecretEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extractFeishuVerificationToken(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { source: null, token: null };
  }

  const body = payload as {
    token?: unknown;
    header?: {
      token?: unknown;
    };
  };

  if (typeof body.token === "string" && body.token.trim()) {
    return { source: "body.token", token: body.token.trim() };
  }

  if (typeof body.header?.token === "string" && body.header.token.trim()) {
    return { source: "header.token", token: body.header.token.trim() };
  }

  return { source: null, token: null };
}

function buildFeishuActionCard(text: string) {
  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: "div", text: { tag: "plain_text", content: text } }],
  };
}

function buildFeishuActionResponse(
  text: string,
  options?: {
    legacy?: boolean;
    toastType?: "success" | "info" | "warning" | "error";
  },
) {
  const card = buildFeishuActionCard(text);
  if (options?.legacy) {
    return card;
  }

  return {
    toast: {
      type: options?.toastType ?? "info",
      content: text,
    },
    card: {
      type: "raw",
      data: card,
    },
  };
}

function buildFeishuSdkRequestData(
  request: Request,
  payload: Record<string, unknown>,
) {
  return Object.assign(
    Object.create({
      headers: Object.fromEntries(request.headers.entries()),
    }),
    payload,
  );
}

async function processFeishuApprovalAction(params: {
  agentId: string;
  actionStr: string;
  callerUid: string;
}) {
  const { agentId, actionStr, callerUid } = params;
  const match = actionStr.match(/^(approve|reject):(.+)$/);
  if (!match) {
    return null;
  }

  const [, act, channelId] = match;
  const result = await processChannelApproval({
    action: act as "approve" | "reject",
    channelId,
    callerUid,
    fallbackAgentId: agentId,
  });

  const rawLocale = await getAgentLocale(agentId);
  const locale = getBotLocaleOrDefault(rawLocale);

  if (!result) {
    return {
      responseText: botT(locale, "alreadyProcessedDot"),
      toastType: "info" as const,
    };
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
        const { data: aRow } = await getSupabase().from("agents").select("name").eq("id", result.agentId).single();
        const agentName = (aRow as { name?: string } | null)?.name || "Agent";
        const welcomeText = buildWelcomeText(locale, agentName, result.targetPlatform);
        await targetSender.sendMarkdown(result.targetUid, welcomeText);
      }
    } catch {
      /* target unreachable */
    }
  }

  return {
    responseText: act === "approve"
      ? botT(locale, "approved", { name: result.name })
      : botT(locale, "rejected", { name: result.name }),
    toastType: act === "approve" ? "success" as const : "warning" as const,
  };
}

async function getFeishuCredentials(agentId: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "feishu")
    .in("credential_type", ["encrypt_key", "verification_token"]);

  const credentials: Record<string, string> = {};
  for (const row of data || []) {
    credentials[row.credential_type] = decrypt(row.encrypted_value);
  }

  return {
    encryptKey: credentials.encrypt_key || null,
    verificationToken: credentials.verification_token || null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const rawBody = await request.text();
    const rawEnvelope = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
    let body = rawEnvelope;
    const { encryptKey, verificationToken } = await getFeishuCredentials(agentId);
    const expectedToken = normalizeSecret(verificationToken);
    const encryptedPayload =
      body && typeof body === "object" && typeof (body as { encrypt?: unknown }).encrypt === "string"
        ? (body as { encrypt: string }).encrypt
        : null;
    const hasEncryptEnvelope = !!encryptedPayload;

    if (encryptedPayload) {
      if (!encryptKey) {
        return NextResponse.json({ error: "No encrypt key configured" }, { status: 500 });
      }
      body = JSON.parse(decryptFeishuEvent(encryptedPayload, encryptKey));
    }

    if (!expectedToken) {
      console.error("Feishu webhook rejected: verification token is not configured", {
        agentId,
      });
      return NextResponse.json(
        { error: "Feishu verification token is not configured" },
        { status: 500 },
      );
    }

    const callbackEventType =
      body && typeof body === "object" && typeof (body as { header?: { event_type?: unknown } }).header?.event_type === "string"
        ? (body as { header: { event_type: string } }).header.event_type
        : null;
    const isLegacyCardCallback =
      (body && typeof body === "object" && (body as { type?: unknown }).type === "interactive")
      || callbackEventType === "card.action.trigger_v1";

    if (body.challenge) {
      return NextResponse.json({ challenge: body.challenge });
    }

    if (isLegacyCardCallback) {
      console.info("Feishu legacy card callback received", {
        agentId,
        hasEncryptEnvelope,
        eventType: callbackEventType,
      });
      const handler = new CardActionHandler(
        {
          encryptKey: encryptKey ?? undefined,
          verificationToken: expectedToken,
        },
        async (data: Record<string, unknown>) => {
          const openId =
            typeof data.open_id === "string"
              ? data.open_id
              : typeof (data.operator as { open_id?: unknown } | undefined)?.open_id === "string"
                ? ((data.operator as { open_id: string }).open_id)
                : "";
          const actionStr =
            typeof (data.action as { value?: Record<string, unknown> } | undefined)?.value?.action === "string"
              ? String((data.action as { value: Record<string, unknown> }).value.action)
              : "";
          const outcome = await processFeishuApprovalAction({
            agentId,
            actionStr,
            callerUid: openId,
          });

          if (!outcome) {
            return {};
          }

          return buildFeishuActionCard(outcome.responseText);
        },
      );

      const response = await handler.invoke(buildFeishuSdkRequestData(request, rawEnvelope));
      console.info("Feishu legacy card callback response", {
        agentId,
        hasResponse: !!response,
      });
      return NextResponse.json(response ?? {});
    }

    const incomingToken = extractFeishuVerificationToken(body);
    if (!incomingToken.token || !safeSecretEquals(incomingToken.token, expectedToken)) {
      console.warn("Feishu webhook rejected: verification token mismatch", {
        agentId,
        hasEncryptEnvelope,
        eventType: callbackEventType,
        schema:
          body && typeof body === "object" && typeof (body as { schema?: unknown }).schema === "string"
            ? (body as { schema: string }).schema
            : null,
        tokenSource: incomingToken.source,
        hasBodyToken:
          !!body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string",
        hasHeaderToken:
          !!body
          && typeof body === "object"
          && typeof (body as { header?: { token?: unknown } }).header?.token === "string",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Card action callback (approval buttons)
    const isModernCardCallback = callbackEventType === "card.action.trigger";
    if (isModernCardCallback) {
      console.info("Feishu modern card callback received", {
        agentId,
        hasEncryptEnvelope,
        eventType: callbackEventType,
      });
      const action = body.action || body.event?.action;
      const value = action?.value as Record<string, string> | undefined;
      const outcome = await processFeishuApprovalAction({
        agentId,
        actionStr: value?.action || "",
        callerUid: body.open_id || body.event?.operator?.open_id || "",
      });

      if (outcome) {
        console.info("Feishu modern card callback response", {
          agentId,
          toastType: outcome.toastType,
        });
        return NextResponse.json(
          buildFeishuActionResponse(outcome.responseText, {
            toastType: outcome.toastType,
          }),
        );
      }
      return NextResponse.json({});
    }

    const header = body.header;
    if (!header || header.event_type !== "im.message.receive_v1") {
      return NextResponse.json({ ok: true });
    }

    const event = body.event;
    const msg = event?.message;
    if (!msg) return NextResponse.json({ ok: true });

    const chatId = msg.chat_id;
    const senderId = event.sender?.sender_id?.open_id || null;
    const msgType = msg.message_type;

    let senderName: string | null = null;
    if (senderId) {
      senderName = await getFeishuUserName(agentId, senderId, chatId);
    }
    const messageId = msg.message_id;

    let text = "";
    let fileRef: string | null = null;
    let fileMime: string | null = null;

    if (msgType === "text") {
      try {
        const parsed = JSON.parse(msg.content);
        text = parsed.text || "";
      } catch {
        text = msg.content || "";
      }
    } else if (msgType === "post") {
      try {
        const parsed = JSON.parse(msg.content);
        // Received post: direct { content: [[...]] } or nested { zh_cn: { content: [[...]] } }
        let rows: Array<Array<Record<string, string>>> | undefined;
        if (Array.isArray(parsed.content)) {
          rows = parsed.content;
        } else {
          const lang = parsed.zh_cn || parsed.en_us;
          if (lang && Array.isArray(lang.content)) {
            rows = lang.content;
          }
        }
        if (rows) {
          const texts: string[] = [];
          let firstImageKey: string | null = null;
          for (const row of rows) {
            for (const el of row) {
              if (el.tag === "text") texts.push(el.text || "");
              else if (el.tag === "a") texts.push(el.text || el.href || "");
              else if (el.tag === "img" && !firstImageKey) firstImageKey = el.image_key;
            }
          }
          text = texts.join("").trim();
          if (firstImageKey) {
            fileRef = `${messageId}|${firstImageKey}|image`;
            fileMime = "image/jpeg";
          }
        }
      } catch {
        /* skip */
      }
    } else if (msgType === "audio" || msgType === "file" || msgType === "image") {
      try {
        const parsed = JSON.parse(msg.content);
        const key = parsed.file_key || parsed.image_key || null;
        if (key) {
          const resType = msgType === "image" ? "image" : "file";
          fileRef = `${messageId}|${key}|${resType}`;
        }
        if (msgType === "file" && parsed.file_name) {
          const fn = (parsed.file_name as string).toLowerCase();
          if (fn.endsWith(".pdf")) fileMime = "application/pdf";
          else if (fn.endsWith(".doc") || fn.endsWith(".docx")) fileMime = "application/msword";
          else if (fn.endsWith(".xls") || fn.endsWith(".xlsx")) fileMime = "application/vnd.ms-excel";
          else if (fn.endsWith(".png")) fileMime = "image/png";
          else if (fn.endsWith(".jpg") || fn.endsWith(".jpeg")) fileMime = "image/jpeg";
        }
      } catch {
        /* skip */
      }
      if (!fileMime) {
        if (msgType === "audio") fileMime = "audio/opus";
        else if (msgType === "image") fileMime = "image/jpeg";
      }
    } else {
      return NextResponse.json({ ok: true });
    }

    return handleInboundMessage({
      platform: "feishu",
      agentId,
      platformChatId: chatId,
      platformUid: senderId,
      displayName: senderName,
      text,
      fileRef,
      fileMime,
      rawPayload: {
        update_id: messageId,
        message_extra: {
          message_id: messageId,
          sender: event.sender,
          chat_type: msg.chat_type,
        },
      },
      dedupKey: `feishu:${agentId}:${chatId}:${messageId}`,
    });
  } catch (err) {
    console.error("Feishu webhook error:", err);
    return NextResponse.json({ error: "Failed to handle webhook" }, { status: 500 });
  }
}
