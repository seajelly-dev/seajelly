import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBot, resetBot } from "@/lib/telegram/bot";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, webhook_url } = await request.json();

  if (action === "set-webhook") {
    if (!webhook_url) {
      return NextResponse.json(
        { error: "webhook_url required" },
        { status: 400 }
      );
    }

    try {
      resetBot();
      const bot = await getBot();
      await bot.api.setWebhook(webhook_url);
      return NextResponse.json({ success: true, webhook_url });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to set webhook" },
        { status: 500 }
      );
    }
  }

  if (action === "get-info") {
    try {
      resetBot();
      const bot = await getBot();
      const info = await bot.api.getWebhookInfo();
      const me = await bot.api.getMe();
      return NextResponse.json({ webhook: info, bot: me });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to get info" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
