import { createClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/memory/embedding";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface VectorizeResult {
  success: boolean;
  total: number;
  embedded: number;
  failed: number;
  error?: string;
}

export async function vectorizeChunks(chunkIds: string[], embedModel?: string): Promise<VectorizeResult> {
  const supabase = getSupabase();
  let embedded = 0;
  let failed = 0;

  for (const chunkId of chunkIds) {
    const { data: chunk } = await supabase
      .from("knowledge_chunks")
      .select("id, chunk_text, embed_status")
      .eq("id", chunkId)
      .single();

    if (!chunk) {
      failed++;
      continue;
    }

    if (chunk.embed_status === "embedded") {
      embedded++;
      continue;
    }

    await supabase
      .from("knowledge_chunks")
      .update({ embed_status: "embedding" })
      .eq("id", chunkId);

    try {
      const modelName = embedModel || "gemini-embedding-001";
      const embedding = await embedText(chunk.chunk_text, modelName, "RETRIEVAL_DOCUMENT");
      if (embedding && embedding.length > 0) {
        const embeddingStr = `[${embedding.join(",")}]`;
        const { error: updateErr } = await supabase
          .from("knowledge_chunks")
          .update({
            embedding: embeddingStr,
            embed_model: modelName,
            embed_status: "embedded",
          })
          .eq("id", chunkId);
        if (updateErr) {
          console.error(`[vectorize] DB update failed for chunk ${chunkId}:`, updateErr.message);
          await supabase
            .from("knowledge_chunks")
            .update({ embed_status: "failed" })
            .eq("id", chunkId);
          failed++;
        } else {
          embedded++;
        }
      } else {
        console.error(`[vectorize] embedText returned null for chunk ${chunkId}`);
        await supabase
          .from("knowledge_chunks")
          .update({ embed_status: "failed" })
          .eq("id", chunkId);
        failed++;
      }
    } catch (err) {
      console.error(`[vectorize] Exception for chunk ${chunkId}:`, err);
      await supabase
        .from("knowledge_chunks")
        .update({ embed_status: "failed" })
        .eq("id", chunkId);
      failed++;
    }
  }

  return { success: true, total: chunkIds.length, embedded, failed };
}

export async function vectorizeByArticle(articleId: string, embedModel?: string): Promise<VectorizeResult> {
  const supabase = getSupabase();

  const { data: chunks } = await supabase
    .from("knowledge_chunks")
    .select("id")
    .eq("article_id", articleId)
    .in("embed_status", ["pending", "failed"]);

  if (!chunks || chunks.length === 0) {
    return { success: true, total: 0, embedded: 0, failed: 0 };
  }

  const result = await vectorizeChunks(chunks.map((c) => c.id), embedModel);

  // Update article's chunks_count with total embedded
  const { count } = await supabase
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("article_id", articleId)
    .eq("embed_status", "embedded");

  await supabase
    .from("knowledge_articles")
    .update({ chunks_count: count ?? 0 })
    .eq("id", articleId);

  return result;
}
