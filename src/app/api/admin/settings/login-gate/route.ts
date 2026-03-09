import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import {
  LOGIN_GATE_ENABLED_KEY,
  LOGIN_GATE_HASH_KEY,
  LOGIN_GATE_QUERY_PARAM,
  parseBooleanText,
  sha256Hex,
} from "@/lib/security/login-gate";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", [LOGIN_GATE_ENABLED_KEY, LOGIN_GATE_HASH_KEY]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;

  return NextResponse.json({
    enabled: parseBooleanText(map[LOGIN_GATE_ENABLED_KEY]),
    configured: !!map[LOGIN_GATE_HASH_KEY],
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = (await request.json()) as {
    mode?: "generate" | "set" | "disable";
    key?: string;
  };
  const mode = body.mode ?? "generate";
  const key = (body.key ?? "").trim();

  const db = await createAdminClient();

  if (mode === "disable") {
    const { error } = await db
      .from("system_settings")
      .upsert(
        [{ key: LOGIN_GATE_ENABLED_KEY, value: "false", updated_at: new Date().toISOString() }],
        { onConflict: "key" }
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, enabled: false });
  }

  let rawKey = key;
  if (mode === "generate") {
    rawKey = randomBytes(24).toString("hex");
  } else if (mode === "set") {
    if (rawKey.length < 16) {
      return NextResponse.json(
        { error: "Custom key must be at least 16 characters" },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const hash = await sha256Hex(rawKey);
  const { error } = await db.from("system_settings").upsert(
    [
      { key: LOGIN_GATE_ENABLED_KEY, value: "true", updated_at: new Date().toISOString() },
      { key: LOGIN_GATE_HASH_KEY, value: hash, updated_at: new Date().toISOString() },
    ],
    { onConflict: "key" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const origin = new URL(request.url).origin.replace(/\/+$/, "");
  const loginUrl = `${origin}/login?${LOGIN_GATE_QUERY_PARAM}=${encodeURIComponent(rawKey)}`;
  const dashboardUrl = `${origin}/dashboard?${LOGIN_GATE_QUERY_PARAM}=${encodeURIComponent(rawKey)}`;

  return NextResponse.json({
    success: true,
    key: rawKey,
    loginUrl,
    dashboardUrl,
  });
}
