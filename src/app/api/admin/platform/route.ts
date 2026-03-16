import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { fetchGatewayManifest } from "@/lib/gateway/client";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import {
  createTelegramBot,
  getBotForAgent,
  resetBotForAgent,
} from "@/lib/telegram/bot";
import { getBotCommands, getBotLocaleOrDefault } from "@/lib/i18n/bot";

async function getAgentBotCommands(agentId: string) {
  const db = await createAdminClient();
  const { data } = await db.from("agents").select("bot_locale").eq("id", agentId).single();
  return getBotCommands(getBotLocaleOrDefault(data?.bot_locale));
}

async function handleTelegram(action: string, agentId: string, body: Record<string, unknown>) {
  const inlineToken = (body.inline_token as string | undefined)?.trim();
  const resolveBot = async () => {
    if (inlineToken) {
      return createTelegramBot(inlineToken);
    }
    resetBotForAgent(agentId);
    return getBotForAgent(agentId);
  };

  if (action === "set-webhook") {
    const webhookUrl = body.webhook_url as string | undefined;
    if (!webhookUrl) {
      return NextResponse.json({ error: "webhook_url required" }, { status: 400 });
    }
    const bot = await resolveBot();
    const webhookWithAgent = webhookUrl.includes("/[agentId]")
      ? webhookUrl.replace("/[agentId]", `/${agentId}`)
      : `${webhookUrl}/${agentId}`;
    const secret = randomBytes(32).toString("hex");
    await bot.api.setWebhook(webhookWithAgent, { secret_token: secret });
    const cmds = await getAgentBotCommands(agentId);
    await bot.api.setMyCommands(cmds);
    const db = await createAdminClient();
    await db.from("agents").update({ webhook_secret: secret }).eq("id", agentId);
    return NextResponse.json({ success: true, webhook_url: webhookWithAgent });
  }

  if (action === "register-commands") {
    const bot = await resolveBot();
    const cmds = await getAgentBotCommands(agentId);
    await bot.api.setMyCommands(cmds);
    return NextResponse.json({ success: true, commands: cmds });
  }

  if (action === "get-info") {
    const bot = await resolveBot();
    const info = await bot.api.getWebhookInfo();
    const me = await bot.api.getMe();
    return NextResponse.json({ webhook: info, bot: me });
  }

  if (action === "test-connection") {
    if (inlineToken) {
      const tmpBot = createTelegramBot(inlineToken);
      const me = await tmpBot.api.getMe();
      return NextResponse.json({ success: true, message: `Bot @${me.username} is alive` });
    }
    const bot = await resolveBot();
    const me = await bot.api.getMe();
    return NextResponse.json({ success: true, message: `Bot @${me.username} is alive` });
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
      configured: types.includes("app_id") && types.includes("app_secret") && types.includes("verification_token"),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/feishu/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const inline = body.inline_credentials as Record<string, string> | undefined;
    let appId: string;
    let appSecret: string;
    if (inline?.app_id?.trim() && inline?.app_secret?.trim()) {
      appId = inline.app_id.trim();
      appSecret = inline.app_secret.trim();
    } else {
      const db = await createAdminClient();
      const { data: rows } = await db
        .from("agent_credentials")
        .select("credential_type, encrypted_value")
        .eq("agent_id", agentId)
        .eq("platform", "feishu");
      const { decrypt } = await import("@/lib/crypto/encrypt");
      const map: Record<string, string> = {};
      for (const r of rows || []) map[r.credential_type] = decrypt(r.encrypted_value);
      if (!map.app_id || !map.app_secret) throw new Error("Feishu credentials not configured");
      appId = map.app_id;
      appSecret = map.app_secret;
    }
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg || `Feishu auth failed (code ${data.code})`);
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
    const inline = body.inline_credentials as Record<string, string> | undefined;
    let corpId: string;
    let corpSecret: string;
    if (inline?.corp_id?.trim() && inline?.corp_secret?.trim()) {
      corpId = inline.corp_id.trim();
      corpSecret = inline.corp_secret.trim();
    } else {
      const db = await createAdminClient();
      const { data: rows } = await db
        .from("agent_credentials")
        .select("credential_type, encrypted_value")
        .eq("agent_id", agentId)
        .eq("platform", "wecom");
      const { decrypt } = await import("@/lib/crypto/encrypt");
      const map: Record<string, string> = {};
      for (const r of rows || []) map[r.credential_type] = decrypt(r.encrypted_value);
      if (!map.corp_id || !map.corp_secret) throw new Error("WeCom credentials not configured");
      corpId = map.corp_id;
      corpSecret = map.corp_secret;
    }
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`);
    const data = await res.json();
    if (data.errcode !== 0) throw new Error(data.errmsg || `WeCom auth failed (code ${data.errcode})`);
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
    const inline = body.inline_credentials as Record<string, string> | undefined;
    let botToken: string;
    if (inline?.bot_token?.trim()) {
      botToken = inline.bot_token.trim();
    } else {
      const db = await createAdminClient();
      const { data: rows } = await db
        .from("agent_credentials")
        .select("credential_type, encrypted_value")
        .eq("agent_id", agentId)
        .eq("platform", "slack");
      const { decrypt } = await import("@/lib/crypto/encrypt");
      const map: Record<string, string> = {};
      for (const r of rows || []) map[r.credential_type] = decrypt(r.encrypted_value);
      if (!map.bot_token) throw new Error("Slack bot_token not configured");
      botToken = map.bot_token;
    }
    const { WebClient } = await import("@slack/web-api");
    const client = new WebClient(botToken);
    const result = await client.auth.test();
    if (!result.ok) throw new Error("Slack auth.test failed");
    return NextResponse.json({ success: true, message: `Slack bot @${result.user} is alive` });
  }
  return NextResponse.json({ error: "Invalid action for slack" }, { status: 400 });
}

async function handleQQBot(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "get-info") {
    const db = await createAdminClient();
    const { data: creds } = await db
      .from("agent_credentials")
      .select("credential_type")
      .eq("agent_id", agentId)
      .eq("platform", "qqbot");
    const types = (creds || []).map((c: { credential_type: string }) => c.credential_type);
    return NextResponse.json({
      configured: types.includes("app_id") && types.includes("app_secret"),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/qqbot/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const inline = body.inline_credentials as Record<string, string> | undefined;
    let appId: string;
    let appSecret: string;
    if (inline?.app_id?.trim() && inline?.app_secret?.trim()) {
      appId = inline.app_id.trim();
      appSecret = inline.app_secret.trim();
    } else {
      const { resolveQQBotCredentials, invalidateQQBotCache } = await import("@/lib/platform/adapters/qqbot");
      invalidateQQBotCache(agentId);
      const creds = await resolveQQBotCredentials(agentId);
      appId = creds.appId;
      appSecret = creds.appSecret;
    }
    const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    });
    const data = await res.json();
    if (!res.ok || data.code) {
      throw new Error(data.message || `QQBot token request failed: ${res.status}`);
    }
    if (!data.access_token) {
      throw new Error("QQBot returned no access_token");
    }
    return NextResponse.json({ success: true, message: `QQBot credentials valid (token expires in ${data.expires_in}s)` });
  }
  return NextResponse.json({ error: "Invalid action for qqbot" }, { status: 400 });
}

async function handleWhatsApp(action: string, agentId: string, body: Record<string, unknown>) {
  if (action === "get-info") {
    const db = await createAdminClient();
    const { data: creds } = await db
      .from("agent_credentials")
      .select("credential_type")
      .eq("agent_id", agentId)
      .eq("platform", "whatsapp");
    const types = (creds || []).map((c: { credential_type: string }) => c.credential_type);
    return NextResponse.json({
      configured: (
        types.includes("access_token")
        && types.includes("phone_number_id")
        && types.includes("verify_token")
        && types.includes("app_secret")
      ),
      credentials: types,
      webhook_url: `${body.base_url || ""}/api/webhook/whatsapp/${agentId}`,
    });
  }
  if (action === "test-connection") {
    const inline = body.inline_credentials as Record<string, string> | undefined;
    let accessToken: string;
    let phoneNumberId: string;
    if (inline?.access_token?.trim() && inline?.phone_number_id?.trim()) {
      accessToken = inline.access_token.trim();
      phoneNumberId = inline.phone_number_id.trim();
    } else {
      const db = await createAdminClient();
      const { data: rows } = await db
        .from("agent_credentials")
        .select("credential_type, encrypted_value")
        .eq("agent_id", agentId)
        .eq("platform", "whatsapp");
      const { decrypt } = await import("@/lib/crypto/encrypt");
      const map: Record<string, string> = {};
      for (const r of rows || []) map[r.credential_type] = decrypt(r.encrypted_value);
      if (!map.access_token || !map.phone_number_id) throw new Error("WhatsApp credentials not configured");
      accessToken = map.access_token;
      phoneNumberId = map.phone_number_id;
    }
    const resp = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await resp.json();
    if (data.error) {
      const err = data.error as { message?: string; code?: number; error_subcode?: number };
      if (err.code === 190) {
        throw new Error(
          "WhatsApp access token is expired/invalid (code 190). Please replace it with a permanent System User token from Meta Business Settings.",
        );
      }
      throw new Error(err.message || "WhatsApp API error");
    }
    const displayPhone = data.display_phone_number || data.verified_name || phoneNumberId;
    return NextResponse.json({ success: true, message: `WhatsApp Business: ${displayPhone}` });
  }
  return NextResponse.json({ error: "Invalid action for whatsapp" }, { status: 400 });
}

async function handleGateway(action: string, body: Record<string, unknown>) {
  if (action === "test-gateway") {
    const gatewayUrl = (body.gateway_url as string)?.trim();
    const gatewaySecret = (body.gateway_secret as string)?.trim();
    if (!gatewayUrl || !gatewaySecret) {
      return NextResponse.json({ error: "gateway_url and gateway_secret required" }, { status: 400 });
    }
    const data = await fetchGatewayManifest({ url: gatewayUrl, secret: gatewaySecret });
    return NextResponse.json({
      success: true,
      ip: data.publicIp,
      version: data.version,
      config_version: data.configVersion,
      capabilities: data.capabilities,
    });
  }
  return NextResponse.json({ error: "Invalid gateway action" }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { platform, action, agent_id } = body;

  if (platform === "gateway") {
    try {
      return await handleGateway(action, body);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500 },
      );
    }
  }

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
      case "qqbot":
        return await handleQQBot(action, agent_id, body);
      case "whatsapp":
        return await handleWhatsApp(action, agent_id, body);
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
