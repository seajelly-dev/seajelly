import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import { clearSecretsCache } from "@/lib/secrets";

export async function GET() {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("secrets")
    .select("id, key_name, updated_at")
    .order("key_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ secrets: data });
}

export async function PUT(request: Request) {
  let user;
  try { user = await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();

  const admin = await db
    .from("admins")
    .select("id")
    .eq("auth_uid", user.id)
    .single();

  if (!admin.data) {
    return NextResponse.json({ error: "Not an admin" }, { status: 403 });
  }

  const body = await request.json();
  const { key_name, value } = body;

  if (!key_name || !value) {
    return NextResponse.json(
      { error: "key_name and value required" },
      { status: 400 }
    );
  }

  const encryptedValue = encrypt(value);

  const { error } = await db.from("secrets").upsert(
    {
      key_name,
      encrypted_value: encryptedValue,
      created_by: admin.data.id,
    },
    { onConflict: "key_name" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  clearSecretsCache();

  return NextResponse.json({ success: true });
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

  const { error } = await db.from("secrets").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  clearSecretsCache();

  return NextResponse.json({ success: true });
}
