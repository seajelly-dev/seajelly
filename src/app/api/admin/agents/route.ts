import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import { getBotForAgent, resetBotForAgent } from "@/lib/telegram/bot";
import { BOT_COMMANDS } from "@/lib/telegram/commands";

async function syncBotCommands(agentId: string) {
  try {
    const bot = await getBotForAgent(agentId);
    await bot.api.setMyCommands(BOT_COMMANDS);
  } catch (err) {
    console.warn("Sync bot commands failed (non-blocking):", err);
  }
}

async function autoSetWebhook(agentId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return;
  try {
    resetBotForAgent(agentId);
    const bot = await getBotForAgent(agentId);
    const secret = randomBytes(32).toString("hex");
    await bot.api.setWebhook(`${appUrl}/api/webhook/telegram/${agentId}`, {
      secret_token: secret,
    });
    await bot.api.setMyCommands(BOT_COMMANDS);
    const db = await createAdminClient();
    await db.from("agents").update({ webhook_secret: secret }).eq("id", agentId);
  } catch (err) {
    console.warn("Auto-webhook failed (non-blocking):", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertCredential(db: any, agentId: string, platform: string, credentialType: string, rawValue: string) {
  const encrypted = encrypt(rawValue);
  const { error } = await db
    .from("agent_credentials")
    .upsert(
      { agent_id: agentId, platform, credential_type: credentialType, encrypted_value: encrypted },
      { onConflict: "agent_id,platform,credential_type" },
    );
  if (error) console.warn("upsertCredential error:", error.message);
}

export async function GET() {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const agentIds = (data ?? []).map((a) => a.id);
  const { data: creds } = agentIds.length > 0
    ? await db
        .from("agent_credentials")
        .select("agent_id, platform, credential_type")
        .in("agent_id", agentIds)
    : { data: [] };

  const credMap = new Map<string, Set<string>>();
  for (const c of creds ?? []) {
    const key = c.agent_id;
    if (!credMap.has(key)) credMap.set(key, new Set());
    credMap.get(key)!.add(`${c.platform}:${c.credential_type}`);
  }

  const agents = (data ?? []).map((a) => {
    const agentCreds = credMap.get(a.id);
    const hasTelegramCred = agentCreds?.has("telegram:bot_token") ?? false;
    return {
      ...a,
      telegram_bot_token: a.telegram_bot_token ? "••••••" : null,
      has_bot_token: !!a.telegram_bot_token || hasTelegramCred,
    };
  });

  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const body = await request.json();
  const { name, system_prompt, model, provider_id, tools_config, access_mode, ai_soul, telegram_bot_token } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const insertData: Record<string, unknown> = {
    name,
    system_prompt: system_prompt || "",
    model: model || "claude-sonnet-4-6",
    provider_id: provider_id || null,
    tools_config: tools_config || {},
    access_mode: access_mode || "open",
    ai_soul: ai_soul || "",
  };

  if (telegram_bot_token) {
    insertData.telegram_bot_token = encrypt(telegram_bot_token);
  }

  const { data, error } = await db
    .from("agents")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data?.id && telegram_bot_token) {
    await upsertCredential(db, data.id, "telegram", "bot_token", telegram_bot_token);
    autoSetWebhook(data.id);
  }

  return NextResponse.json({
    agent: { ...data, telegram_bot_token: data.telegram_bot_token ? "••••••" : null },
  });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const body = await request.json();
  const { id, telegram_bot_token, ...rest } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { ...rest };

  const newToken = telegram_bot_token && telegram_bot_token !== "••••••";
  if (newToken) {
    updates.telegram_bot_token = encrypt(telegram_bot_token);
  }

  const { data, error } = await db
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (newToken && data?.id) {
    await upsertCredential(db, data.id, "telegram", "bot_token", telegram_bot_token);
    autoSetWebhook(data.id);
  } else if (data?.id && data?.telegram_bot_token) {
    syncBotCommands(data.id);
  }

  return NextResponse.json({
    agent: { ...data, telegram_bot_token: data.telegram_bot_token ? "••••••" : null },
  });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await db.from("agents").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const [{ data: agentData }, { data: credData }] = await Promise.all([
    db.from("agents").select("telegram_bot_token").eq("id", id).single(),
    db.from("agent_credentials")
      .select("id")
      .eq("agent_id", id)
      .eq("platform", "telegram")
      .eq("credential_type", "bot_token")
      .maybeSingle(),
  ]);

  return NextResponse.json({ has_token: !!agentData?.telegram_bot_token || !!credData });
}
