import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const kbId = searchParams.get("knowledge_base_id");

  const db = await createAdminClient();
  let query = db
    .from("knowledge_articles")
    .select("*")
    .order("created_at", { ascending: false });

  if (kbId) {
    query = query.eq("knowledge_base_id", kbId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const articles = data ?? [];
  if (articles.length > 0) {
    const articleIds = articles.map((a) => a.id);
    const { data: embedStats } = await db
      .from("knowledge_chunks")
      .select("article_id, embed_status")
      .in("article_id", articleIds);

    const statsMap = new Map<string, { embedded: number; total: number }>();
    for (const row of embedStats ?? []) {
      const s = statsMap.get(row.article_id) ?? { embedded: 0, total: 0 };
      s.total++;
      if (row.embed_status === "embedded") s.embedded++;
      statsMap.set(row.article_id, s);
    }

    for (const article of articles) {
      const s = statsMap.get(article.id);
      (article as Record<string, unknown>).embedded_count = s?.embedded ?? 0;
      (article as Record<string, unknown>).total_chunks = s?.total ?? 0;
    }
  }

  return NextResponse.json({ articles });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { knowledge_base_id, title, content, source_url } = body;

  if (!knowledge_base_id || !title) {
    return NextResponse.json(
      { error: "knowledge_base_id and title are required" },
      { status: 400 }
    );
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("knowledge_articles")
    .insert({
      knowledge_base_id,
      title,
      content: content || "",
      source_url: source_url || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ article: data });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowedFields = ["title", "content", "source_url", "knowledge_base_id", "metadata"];
  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) filtered[key] = updates[key];
  }

  if (filtered.content !== undefined) {
    filtered.chunk_status = "pending";
    filtered.chunks_count = 0;
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("knowledge_articles")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (filtered.content !== undefined) {
    await db.from("knowledge_chunks").delete().eq("article_id", id);
  }

  return NextResponse.json({ article: data });
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = await createAdminClient();
  const { error } = await db.from("knowledge_articles").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
