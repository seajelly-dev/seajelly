import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/platform/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const gatewaySecret = request.headers.get("x-gateway-secret");
    const bridgeSource = request.headers.get("x-bridge-source");
    const expectedSecret = process.env.GATEWAY_SECRET;

    if (!expectedSecret || gatewaySecret !== expectedSecret) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    if (bridgeSource !== "ilink") {
      return NextResponse.json({ ok: false, error: "invalid bridge source" }, { status: 400 });
    }

    const body = await request.json();
    const {
      message_id,
      from_user_id,
      text,
      message_type,
      create_time_ms,
      item_list,
    } = body as {
      message_id: number;
      from_user_id: string;
      to_user_id: string;
      client_id: string;
      create_time_ms: number;
      message_type: string;
      text: string;
      context_token: string;
      item_list: unknown[];
    };

    if (!from_user_id) {
      return NextResponse.json({ ok: true });
    }

    let fileRef: string | null = null;
    let fileMime: string | null = null;
    if (Array.isArray(item_list) && item_list.length > 0) {
      const first = item_list[0] as { type?: number };
      if (first.type === 2) {
        fileRef = `ilink:image:${message_id}`;
        fileMime = "image/jpeg";
      } else if (first.type === 3) {
        fileRef = `ilink:voice:${message_id}`;
        fileMime = "audio/amr";
      } else if (first.type === 4) {
        fileRef = `ilink:file:${message_id}`;
        fileMime = "application/octet-stream";
      } else if (first.type === 5) {
        fileRef = `ilink:video:${message_id}`;
        fileMime = "video/mp4";
      }
    }

    return handleInboundMessage({
      platform: "weixin",
      agentId,
      platformChatId: from_user_id,
      platformUid: from_user_id,
      displayName: null,
      text: text || "",
      fileRef,
      fileMime,
      rawPayload: {
        update_id: message_id,
        message_extra: {
          message_id,
          message_type,
          create_time_ms,
          item_list,
        },
      },
      dedupKey: `weixin:${agentId}:${from_user_id}:${message_id}`,
    });
  } catch (err) {
    console.error("WeChat iLink webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
