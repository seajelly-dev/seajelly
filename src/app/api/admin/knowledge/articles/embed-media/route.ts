import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { embedContent, hasEmbeddingApiKey } from "@/lib/memory/embedding";
import { normalizeImageForEmbedding } from "@/lib/memory/image-normalize";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { article_id, media_base64, media_type, embed_model } = body;

  if (!article_id || !media_base64 || !media_type) {
    return NextResponse.json(
      { error: "article_id, media_base64, and media_type are required" },
      { status: 400 },
    );
  }

  const ALLOWED_MIME = new Set([
    "image/png", "image/jpeg", "image/jpg",
    "image/webp", "image/gif", "image/bmp",
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "video/mp4", "video/quicktime",
    "application/pdf",
  ]);
  if (!ALLOWED_MIME.has(media_type)) {
    return NextResponse.json(
      { error: `Unsupported media type: ${media_type}. Supported: PNG/JPEG/WEBP/GIF/BMP (image will be normalized), MP3/WAV, MP4/MOV, PDF.` },
      { status: 400 },
    );
  }

  if (!(await hasEmbeddingApiKey())) {
    return NextResponse.json(
      { error: "Missing EMBEDDING_API_KEY. Please configure dedicated Embedding API Key in Knowledge settings." },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const model = embed_model || "gemini-embedding-2-preview";
  let embeddingMime = media_type as string;
  let embeddingBase64 = media_base64 as string;
  if (media_type.startsWith("image/")) {
    const normalized = await normalizeImageForEmbedding(media_base64, media_type);
    if (!normalized) {
      return NextResponse.json(
        { error: `Unsupported image type for embedding: ${media_type}` },
        { status: 400 },
      );
    }
    embeddingMime = normalized.mimeType;
    embeddingBase64 = normalized.base64;
    if (normalized.converted) {
      console.log(`[embed-media] converted image for embedding: ${media_type} -> ${embeddingMime}`);
    }
  }

  await supabase
    .from("knowledge_articles")
    .update({ media_embed_status: "embedding", media_embed_model: model, media_type })
    .eq("id", article_id);

  try {
    const embedding = await embedContent(
      [{ inlineData: { mimeType: embeddingMime, data: embeddingBase64 } }],
      model,
      "RETRIEVAL_DOCUMENT",
    );

    if (!embedding || embedding.length === 0) {
      await supabase
        .from("knowledge_articles")
        .update({ media_embed_status: "failed" })
        .eq("id", article_id);
      return NextResponse.json({ error: "Failed to generate embedding" }, { status: 500 });
    }

    const embeddingStr = `[${embedding.join(",")}]`;
    const { error: updateErr } = await supabase
      .from("knowledge_articles")
      .update({
        media_embedding: embeddingStr,
        media_embed_model: model,
        media_embed_status: "embedded",
        media_type,
      })
      .eq("id", article_id);

    if (updateErr) {
      await supabase
        .from("knowledge_articles")
        .update({ media_embed_status: "failed" })
        .eq("id", article_id);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, article_id, model, dimensions: embedding.length });
  } catch (err) {
    await supabase
      .from("knowledge_articles")
      .update({ media_embed_status: "failed" })
      .eq("id", article_id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
