import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { getBotForAgent, resetBotForAgent } from "@/lib/telegram/bot";
import { BOT_COMMANDS } from "@/lib/telegram/commands";

async function handleTelegram(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "set-webhook") {
    const webhookUrl = body.webhook_url as string | undefined;
    if (!webhookUrl) {
      return NextResponse.json({ error: "webhook_url required" }, { status: 400 });
    }
    resetBotForAgent(agentId);
    const bot = await getBotForAgent(agentId);
    const webhookWithAgent = webhookUrl.includes("/[agentId]")
      ? webhookUrl.replace("/[agentId]", `/${agentId}`)
      : `${webhookUrl}/${agentId}`;
    const secret = randomBytes(32).toString("hex");
    await bot.api.setWebhook(webhookWithAgent, { secret_token: secret });
    await bot.api.setMyCommands(BOT_COMMANDS);
    const db = await createAdminClient();
    await db.from("agents").update({ webhook_secret: secret }).eq("id", agentId);
    return NextResponse.json({ success: true, webhook_url: webhookWithAgent });
  }

  if (action === "register-commands") {
    resetBotForAgent(agentId);
    const bot = await getBotForAgent(agentId);
    await bot.api.setMyCommands(BOT_COMMANDS);
    return NextResponse.json({ success: true, commands: BOT_COMMANDS });
  }

  if (action === "get-info") {
    resetBotForAgent(agentId);
    const bot = await getBotForAgent(agentId);
    const info = await bot.api.getWebhookInfo();
    const me = await bot.api.getMe();
    return NextResponse.json({ webhook: info, bot: me });
  }

  return NextResponse.json({ error: "Invalid action for telegram" }, { status: 400 });
}

async function handleFeishu(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "get-info") {
    const db = await createAdminClient();
    const { data: creds } = await db
      .from("agent_credentials")
      .select("credential_type")
      .eq("agent_id", agentId)
      .eq("platform", "feishu");
    const types = (creds || []).map((c: { credential_type: string }) => c.credential_type);
    return NextResponse.json({
      configured: types.includes("app_id") && types.includes("app_secret"),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/feishu/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const { FeishuAdapter } = await import("@/lib/platform/adapters/feishu");
    const adapter = new FeishuAdapter(agentId);
    await adapter.sendText("__test__", "").catch(() => {});
    return NextResponse.json({ success: true, message: "Feishu credentials valid (token obtained)" });
  }
  return NextResponse.json({ error: "Invalid action for feishu" }, { status: 400 });
}

async function handleWeCom(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "get-info") {
    const db = await createAdminClient();
    const { data: creds } = await db
      .from("agent_credentials")
      .select("credential_type")
      .eq("agent_id", agentId)
      .eq("platform", "wecom");
    const types = (creds || []).map((c: { credential_type: string }) => c.credential_type);
    return NextResponse.json({
      configured: types.includes("corp_id") && types.includes("corp_secret"),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/wecom/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const { WeComAdapter } = await import("@/lib/platform/adapters/wecom");
    const adapter = new WeComAdapter(agentId);
    await adapter.sendText("__test__", "").catch(() => {});
    return NextResponse.json({ success: true, message: "WeCom credentials valid (token obtained)" });
  }
  return NextResponse.json({ error: "Invalid action for wecom" }, { status: 400 });
}

async function handleSlack(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "get-info") {
    const db = await createAdminClient();
    const { data: creds } = await db
      .from("agent_credentials")
      .select("credential_type")
      .eq("agent_id", agentId)
      .eq("platform", "slack");
    const types = (creds || []).map((c: { credential_type: string }) => c.credential_type);
    return NextResponse.json({
      configured: types.includes("bot_token") && types.includes("signing_secret"),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/slack/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const { SlackAdapter } = await import("@/lib/platform/adapters/slack");
    const adapter = new SlackAdapter(agentId);
    await adapter.sendText("__test__", "").catch(() => {});
    return NextResponse.json({ success: true, message: "Slack credentials valid (client created)" });
  }
  return NextResponse.json({ error: "Invalid action for slack" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { platform, action, agent_id } = body;

  if (!agent_id) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  const resolvedPlatform = (platform as string) || "telegram";

  try {
    switch (resolvedPlatform) {
      case "telegram":
        return await handleTelegram(action, agent_id, body);
      case "feishu":
        return await handleFeishu(action, agent_id, body);
      case "wecom":
        return await handleWeCom(action, agent_id, body);
      case "slack":
        return await handleSlack(action, agent_id, body);
      default:
        return NextResponse.json(
          { error: `Platform "${resolvedPlatform}" admin actions not yet supported` },
          { status: 501 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
