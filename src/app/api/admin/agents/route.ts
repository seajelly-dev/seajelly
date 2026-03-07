import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto/encrypt";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const agents = (data ?? []).map((a) => ({
    ...a,
    telegram_bot_token: a.telegram_bot_token ? "••••••" : null,
    has_bot_token: !!a.telegram_bot_token,
  }));

  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, system_prompt, model, tools_config, access_mode, ai_soul, telegram_bot_token } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const insertData: Record<string, unknown> = {
    name,
    system_prompt: system_prompt || "",
    model: model || "claude-sonnet-4-20250514",
    tools_config: tools_config || {},
    access_mode: access_mode || "open",
    ai_soul: ai_soul || "",
  };

  if (telegram_bot_token) {
    insertData.telegram_bot_token = encrypt(telegram_bot_token);
  }

  const { data, error } = await supabase
    .from("agents")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agent: { ...data, telegram_bot_token: data.telegram_bot_token ? "••••••" : null },
  });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, telegram_bot_token, ...rest } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { ...rest };

  if (telegram_bot_token === "") {
    updates.telegram_bot_token = null;
  } else if (telegram_bot_token && telegram_bot_token !== "••••••") {
    updates.telegram_bot_token = encrypt(telegram_bot_token);
  }

  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agent: { ...data, telegram_bot_token: data.telegram_bot_token ? "••••••" : null },
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase.from("agents").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agents")
    .select("telegram_bot_token")
    .eq("id", id)
    .single();

  if (error || !data?.telegram_bot_token) {
    return NextResponse.json({ error: "No token found" }, { status: 404 });
  }

  try {
    const token = decrypt(data.telegram_bot_token);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
  }
}
