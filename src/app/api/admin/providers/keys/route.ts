import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("provider_id");

  if (!providerId) {
    return NextResponse.json({ error: "provider_id required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("provider_api_keys")
    .select("id, provider_id, label, is_active, call_count, created_at")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { provider_id, api_key, label } = await request.json();

  if (!provider_id || !api_key) {
    return NextResponse.json({ error: "provider_id and api_key are required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("provider_api_keys")
    .insert({
      provider_id,
      encrypted_value: encrypt(api_key),
      label: label || "",
    })
    .select("id, provider_id, label, is_active, call_count, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { id, is_active, label } = await request.json();

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (is_active !== undefined) updates.is_active = is_active;
  if (label !== undefined) updates.label = label;

  const { data, error } = await db
    .from("provider_api_keys")
    .update(updates)
    .eq("id", id)
    .select("id, provider_id, label, is_active, call_count, created_at")
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
