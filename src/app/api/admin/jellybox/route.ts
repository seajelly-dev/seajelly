import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";

export async function GET() {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { data: storages, error } = await db
    .from("jellybox_storages")
    .select("id, name, account_id, bucket_name, endpoint, public_url, is_active_write, max_bytes, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: files } = await db
    .from("jellybox_files")
    .select("storage_id, file_size");

  const usageMap = new Map<string, { count: number; bytes: number }>();
  for (const f of files ?? []) {
    const entry = usageMap.get(f.storage_id) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += f.file_size;
    usageMap.set(f.storage_id, entry);
  }

  const enriched = (storages ?? []).map((s) => {
    const usage = usageMap.get(s.id) ?? { count: 0, bytes: 0 };
    return { ...s, file_count: usage.count, used_bytes: usage.bytes };
  });

  return NextResponse.json({ storages: enriched });
}

export async function POST(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const body = await request.json();
  const {
    id,
    name,
    account_id,
    bucket_name,
    endpoint,
    public_url,
    access_key_id,
    secret_access_key,
    is_active_write,
    max_bytes,
  } = body;

  if (!name || !account_id || !bucket_name || !endpoint || !public_url) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const db = await createAdminClient();

  if (id) {
    const updates: Record<string, unknown> = {
      name,
      account_id,
      bucket_name,
      endpoint,
      public_url: public_url.replace(/\/+$/, ""),
      is_active_write: is_active_write ?? false,
      max_bytes: max_bytes ?? 10737418240,
      updated_at: new Date().toISOString(),
    };
    if (access_key_id) updates.encrypted_access_key_id = encrypt(access_key_id);
    if (secret_access_key) updates.encrypted_secret_access_key = encrypt(secret_access_key);

    const { error } = await db
      .from("jellybox_storages")
      .update(updates)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!access_key_id || !secret_access_key) {
    return NextResponse.json({ error: "Access Key ID and Secret Access Key are required for new storage" }, { status: 400 });
  }

  const { error } = await db
    .from("jellybox_storages")
    .insert({
      name,
      account_id,
      bucket_name,
      endpoint,
      public_url: public_url.replace(/\/+$/, ""),
      encrypted_access_key_id: encrypt(access_key_id),
      encrypted_secret_access_key: encrypt(secret_access_key),
      is_active_write: is_active_write ?? false,
      max_bytes: max_bytes ?? 10737418240,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = await createAdminClient();
  const { error } = await db
    .from("jellybox_storages")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
