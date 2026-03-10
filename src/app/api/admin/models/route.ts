import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("provider_id");

  let query = db
    .from("models")
    .select("*, providers!inner(name, type)")
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (providerId) {
    query = query.eq("provider_id", providerId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const models = (data ?? []).map((m) => {
    const provider = m.providers as unknown as { name: string; type: string };
    return {
      id: m.id,
      model_id: m.model_id,
      label: m.label,
      provider_id: m.provider_id,
      provider_name: provider?.name ?? "",
      provider_type: provider?.type ?? "",
      is_builtin: m.is_builtin,
      enabled: m.enabled,
      created_at: m.created_at,
    };
  });

  return NextResponse.json({ models });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { model_id, label, provider_id } = await request.json();

  if (!model_id || !label || !provider_id) {
    return NextResponse.json({ error: "model_id, label, and provider_id are required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("models")
    .insert({ model_id, label, provider_id, is_builtin: false })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ model: data });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { id, label, enabled } = await request.json();

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = label;
  if (enabled !== undefined) updates.enabled = enabled;

  const { data, error } = await db
    .from("models")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ model: data });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: model } = await db
    .from("models")
    .select("is_builtin")
    .eq("id", id)
    .single();

  if (model?.is_builtin) {
    return NextResponse.json({ error: "Cannot delete built-in model" }, { status: 403 });
  }

  const { error } = await db.from("models").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
