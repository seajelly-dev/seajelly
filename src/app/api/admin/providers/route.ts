import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET() {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { data: providers, error } = await db
    .from("providers")
    .select("*")
    .order("enabled", { ascending: false })
    .order("is_builtin", { ascending: false })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const providerIds = (providers ?? []).map((p) => p.id);

  const [modelsRes, keysRes] = await Promise.all([
    db.from("models").select("provider_id").in("provider_id", providerIds),
    db.from("provider_api_keys").select("provider_id").in("provider_id", providerIds),
  ]);

  const modelCounts: Record<string, number> = {};
  for (const m of modelsRes.data ?? []) {
    modelCounts[m.provider_id] = (modelCounts[m.provider_id] || 0) + 1;
  }

  const keyCounts: Record<string, number> = {};
  for (const k of keysRes.data ?? []) {
    keyCounts[k.provider_id] = (keyCounts[k.provider_id] || 0) + 1;
  }

  const result = (providers ?? []).map((p) => ({
    ...p,
    model_count: modelCounts[p.id] || 0,
    key_count: keyCounts[p.id] || 0,
  }));

  return NextResponse.json({ providers: result });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { name, type, base_url } = await request.json();

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("providers")
    .insert({ name, type, base_url: base_url || null, is_builtin: false })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ provider: data });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { id, name, base_url, enabled } = await request.json();

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (base_url !== undefined) updates.base_url = base_url || null;
  if (enabled !== undefined) updates.enabled = enabled;

  const { data, error } = await db
    .from("providers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ provider: data });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: provider } = await db
    .from("providers")
    .select("is_builtin")
    .eq("id", id)
    .single();

  if (provider?.is_builtin) {
    return NextResponse.json({ error: "Cannot delete built-in provider" }, { status: 403 });
  }

  const { error } = await db.from("providers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
