import { NextResponse } from "next/server";
import { getBotForAgent } from "@/lib/telegram/bot";

export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET || "opencrab-cron";

  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { agent_id, chat_id, message } = body;

    if (!agent_id || !chat_id || !message) {
      return NextResponse.json(
        { error: "Missing agent_id, chat_id, or message" },
        { status: 400 }
      );
    }

    const bot = await getBotForAgent(agent_id);
    await bot.api
      .sendMessage(chat_id, `🔔 ${message}`, { parse_mode: "Markdown" })
      .catch(async () => {
        await bot.api.sendMessage(chat_id, `🔔 ${message}`);
      });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Remind worker error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
