import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { searchKnowledgeWithArticles } from "@/lib/knowledge/search";

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { query, top_k, threshold, kb_ids } = body;

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const result = await searchKnowledgeWithArticles({
    query,
    topK: top_k ?? 10,
    threshold: threshold ?? 0.5,
    kbIds: kb_ids,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    chunks: result.chunks,
    articles: result.articles,
  });
}
