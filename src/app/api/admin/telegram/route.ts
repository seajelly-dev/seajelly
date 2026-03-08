import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { getBotForAgent, resetBotForAgent } from "@/lib/telegram/bot";
import { BOT_COMMANDS } from "@/lib/telegram/commands";

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { action, agent_id, webhook_url } = await request.json();

  if (!agent_id) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  if (action === "set-webhook") {
    if (!webhook_url) {
      return NextResponse.json(
        { error: "webhook_url required" },
        { status: 400 }
      );
    }

    try {
      resetBotForAgent(agent_id);
      const bot = await getBotForAgent(agent_id);
      const webhookWithAgent = webhook_url.includes("/[agentId]")
        ? webhook_url.replace("/[agentId]", `/${agent_id}`)
        : `${webhook_url}/${agent_id}`;
      const secret = randomBytes(32).toString("hex");
      await bot.api.setWebhook(webhookWithAgent, { secret_token: secret });
      await bot.api.setMyCommands(BOT_COMMANDS);
      const db = await createAdminClient();
      await db.from("agents").update({ webhook_secret: secret }).eq("id", agent_id);
      return NextResponse.json({ success: true, webhook_url: webhookWithAgent });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500 }
      );
    }
  }

  if (action === "register-commands") {
    try {
      resetBotForAgent(agent_id);
      const bot = await getBotForAgent(agent_id);
      await bot.api.setMyCommands(BOT_COMMANDS);
      return NextResponse.json({ success: true, commands: BOT_COMMANDS });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500 }
      );
    }
  }

  if (action === "get-info") {
    try {
      resetBotForAgent(agent_id);
      const bot = await getBotForAgent(agent_id);
      const info = await bot.api.getWebhookInfo();
      const me = await bot.api.getMe();
      return NextResponse.json({ webhook: info, bot: me });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
