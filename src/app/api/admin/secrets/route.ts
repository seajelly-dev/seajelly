import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("secrets")
    .select("id, key_name, updated_at")
    .order("key_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ secrets: data });
}

export async function PUT(request: Request) {
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

  const body = await request.json();
  const { key_name, value } = body;

  if (!key_name || !value) {
    return NextResponse.json(
      { error: "key_name and value required" },
      { status: 400 }
    );
  }

  const encryptedValue = encrypt(value);

  const { error } = await supabase.from("secrets").upsert(
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

  return NextResponse.json({ success: true });
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

  const { error } = await supabase.from("secrets").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
