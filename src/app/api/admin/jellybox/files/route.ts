import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { removeFile } from "@/lib/jellybox/storage";

export async function GET(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const storageId = searchParams.get("storage_id");
  const search = searchParams.get("search");

  const db = await createAdminClient();

  let countQ = db
    .from("jellybox_files")
    .select("id", { count: "exact", head: true })
    .eq("zone", "persistent");
  if (storageId) countQ = countQ.eq("storage_id", storageId);
  if (search) countQ = countQ.ilike("original_name", `%${search}%`);
  const { count } = await countQ;

  let q = db
    .from("jellybox_files")
    .select("*, jellybox_storages(name)")
    .eq("zone", "persistent")
    .order("created_at", { ascending: false })
    .range(from, to);
  if (storageId) q = q.eq("storage_id", storageId);
  if (search) q = q.ilike("original_name", `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    files: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function DELETE(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    await removeFile(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
