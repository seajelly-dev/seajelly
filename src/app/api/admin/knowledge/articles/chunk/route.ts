import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { generateChunks } from "@/lib/knowledge/chunk-generator";

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { article_id, model_id, provider_id } = body;

  if (!article_id) {
    return NextResponse.json({ error: "article_id is required" }, { status: 400 });
  }

  const result = await generateChunks(article_id, {
    modelId: model_id,
    providerId: provider_id,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true, chunks_count: result.count });
}
