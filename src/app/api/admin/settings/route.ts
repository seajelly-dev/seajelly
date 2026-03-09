import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("system_settings")
    .select("key, value, updated_at")
    .order("key");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }

  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const body = await request.json();
  const { key, value } = body as { key: string; value: string };

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  const { error } = await db
    .from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
