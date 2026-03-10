import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";

const KEY_FIELDS = "id, provider_id, label, is_active, call_count, weight, cooldown_until, cooldown_reason, created_at";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("provider_id");

  if (!providerId) {
    return NextResponse.json({ error: "provider_id required" }, { status: 400 });
  }

  const [{ data, error }, { data: statsRows }] = await Promise.all([
    db
      .from("provider_api_keys")
      .select(KEY_FIELDS)
      .eq("provider_id", providerId)
      .order("created_at", { ascending: true }),
    db.rpc("key_usage_stats", { target_provider_id: providerId }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statsMap = new Map<string, { calls_1h: number; calls_24h: number }>();
  for (const row of statsRows ?? []) {
    statsMap.set(row.key_id, { calls_1h: Number(row.calls_1h), calls_24h: Number(row.calls_24h) });
  }

  const keys = (data ?? []).map((k) => ({
    ...k,
    calls_1h: statsMap.get(k.id)?.calls_1h ?? 0,
    calls_24h: statsMap.get(k.id)?.calls_24h ?? 0,
  }));

  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { provider_id, api_key, label, weight } = await request.json();

  if (!provider_id || !api_key) {
    return NextResponse.json({ error: "provider_id and api_key are required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("provider_api_keys")
    .insert({
      provider_id,
      encrypted_value: encrypt(api_key),
      label: label || "",
      weight: Math.max(1, Math.min(10, weight ?? 1)),
    })
    .select(KEY_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { id, is_active, label, weight, cooldown_until } = await request.json();

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (is_active !== undefined) updates.is_active = is_active;
  if (label !== undefined) updates.label = label;
  if (weight !== undefined) updates.weight = Math.max(1, Math.min(10, weight));
  if (cooldown_until !== undefined) {
    updates.cooldown_until = cooldown_until;
    if (cooldown_until === null) updates.cooldown_reason = null;
  }

  const { data, error } = await db
    .from("provider_api_keys")
    .update(updates)
    .eq("id", id)
    .select(KEY_FIELDS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await db.from("provider_api_keys").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
