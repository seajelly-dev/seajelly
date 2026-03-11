import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { vectorizeByArticle, vectorizeChunks } from "@/lib/knowledge/vectorize";

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { article_id, chunk_ids, embed_model } = body;

  if (!article_id && (!chunk_ids || chunk_ids.length === 0)) {
    return NextResponse.json(
      { error: "article_id or chunk_ids is required" },
      { status: 400 }
    );
  }

  const result = article_id
    ? await vectorizeByArticle(article_id, embed_model)
    : await vectorizeChunks(chunk_ids, embed_model);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
