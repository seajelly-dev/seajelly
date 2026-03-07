import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import type { SecretKeyName } from "@/types/database";

export async function GET() {
  const supabase = await createClient();

  const [admins, secrets, agents] = await Promise.all([
    supabase.from("admins").select("*", { count: "exact", head: true }),
    supabase.from("secrets").select("key_name"),
    supabase.from("agents").select("*", { count: "exact", head: true }),
  ]);

  const hasAdmin = (admins.count ?? 0) > 0;
  const secretKeys = (secrets.data ?? []).map((s) => s.key_name);
  const hasRequiredSecrets = secretKeys.includes("SUPABASE_SERVICE_ROLE_KEY");
  const hasLLMKey = secretKeys.some((k) =>
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "DEEPSEEK_API_KEY"].includes(k)
  );
  const hasAgent = (agents.count ?? 0) > 0;

  const setupComplete = hasAdmin && hasRequiredSecrets && hasLLMKey && hasAgent;

  let currentStep = 0;
  if (hasAdmin) currentStep = 1;
  if (hasAdmin && hasRequiredSecrets && hasLLMKey) currentStep = 2;
  if (setupComplete) currentStep = 3;

  return NextResponse.json({
    needsSetup: !setupComplete,
    setupComplete,
    currentStep,
    hasAdmin,
    hasRequiredSecrets,
    hasAgent,
    configuredKeys: secretKeys,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { step } = body;

  if (step === "register") {
    return handleRegister(body);
  }
  if (step === "secrets") {
    return handleSecrets(body);
  }
  if (step === "agent") {
    return handleAgent(body);
  }

  return NextResponse.json({ error: "Invalid step" }, { status: 400 });
}

async function handleRegister(body: { email: string; password: string }) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("admins")
    .select("*", { count: "exact", head: true });

  if (count && count > 0) {
    return NextResponse.json(
      { error: "Admin already registered" },
      { status: 403 }
    );
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message || "Registration failed" },
      { status: 400 }
    );
  }

  const { error: insertError } = await supabase.from("admins").insert({
    auth_uid: authData.user.id,
    email: body.email,
    is_super_admin: true,
  });

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

async function handleSecrets(body: {
  secrets: Record<SecretKeyName, string>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await supabase
    .from("admins")
    .select("id")
    .eq("auth_uid", user.id)
    .single();

  if (!admin.data) {
    return NextResponse.json({ error: "Not an admin" }, { status: 403 });
  }

  const entries = Object.entries(body.secrets).filter(
    ([, value]) => value && value.trim() !== ""
  );

  for (const [keyName, value] of entries) {
    const encryptedValue = encrypt(value as string);
    await supabase.from("secrets").upsert(
      {
        key_name: keyName,
        encrypted_value: encryptedValue,
        created_by: admin.data.id,
      },
      { onConflict: "key_name" }
    );
  }

  return NextResponse.json({ success: true, count: entries.length });
}

async function handleAgent(body: {
  name: string;
  system_prompt: string;
  model: string;
  telegram_bot_token?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const insertData: Record<string, unknown> = {
    name: body.name,
    system_prompt: body.system_prompt,
    model: body.model,
    is_default: true,
  };

  if (body.telegram_bot_token) {
    insertData.telegram_bot_token = encrypt(body.telegram_bot_token);
  }

  const { data, error } = await supabase
    .from("agents")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, agent: data });
}
