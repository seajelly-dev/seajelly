import { generateText } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getModel } from "@/lib/agent/provider";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const DEFAULT_PROMPT = `You are a professional content analyst. Split the following document into semantic knowledge chunks.

## Chunking Strategy

1. **Paragraphs**: Each independent paragraph becomes one chunk. Short consecutive paragraphs on the same topic should be merged.
2. **List items**: Group related list items together into one chunk. Do NOT make each bullet point a separate chunk.
3. **Table rows**: Linearize related rows into natural language sentences and group them into one chunk.
4. **Definitions**: A term, its definition, and any related explanation become one chunk.
5. **Headings**: A heading and its immediately following content form one chunk together.

## Size Constraints (CRITICAL)

- **Minimum**: Each chunk MUST contain at least 50 characters (roughly 20+ Chinese characters or 10+ English words). If a piece of text is shorter than this, merge it with adjacent content.
- **Maximum**: Each chunk should not exceed 2000 characters. If a section is longer, split it at natural semantic boundaries.
- **NEVER** create chunks with only a few words, titles alone, or single short phrases. These must be merged with surrounding content.

## Other Requirements

- Each chunk must be a self-contained, meaningful semantic unit that makes sense when read independently
- Preserve the original text accurately — do not rewrite, summarize, or paraphrase
- Return valid JSON only

Return JSON in this exact format:
\`\`\`json
{
  "chunks": [
    {
      "content": "chunk text here (at least 50 characters)",
      "metadata": { "chunk_type": "paragraph" }
    }
  ]
}
\`\`\`

Document title: {document_title}

Document content:
<<<CONTENT_START>>>
{content}
<<<CONTENT_END>>>

Return ONLY the JSON, no other text:`;

interface ChunkResult {
  content: string;
  metadata: Record<string, unknown>;
}

function parseChunksResponse(text: string): ChunkResult[] | null {
  const cleaned = text.trim();

  function tryParse(json: string): ChunkResult[] | null {
    try {
      const data = JSON.parse(json);
      if (data.chunks && Array.isArray(data.chunks)) {
        const MIN_CHUNK_LENGTH = 20;
        const valid = data.chunks
          .filter((c: Record<string, unknown>) => c.content && typeof c.content === "string" && (c.content as string).trim().length >= MIN_CHUNK_LENGTH)
          .map((c: Record<string, unknown>, i: number) => ({
            content: (c.content as string).trim(),
            metadata: { ...(c.metadata as Record<string, unknown> || {}), chunk_index: i },
          }));
        return valid.length > 0 ? valid : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  const direct = tryParse(cleaned);
  if (direct) return direct;

  if (cleaned.includes("```json")) {
    const start = cleaned.indexOf("```json") + 7;
    const end = cleaned.indexOf("```", start);
    if (end > start) {
      const extracted = cleaned.slice(start, end).trim();
      const result = tryParse(extracted);
      if (result) return result;
    }
  }

  if (cleaned.includes("```")) {
    const start = cleaned.indexOf("```") + 3;
    const end = cleaned.indexOf("```", start);
    if (end > start) {
      const extracted = cleaned.slice(start, end).trim();
      const result = tryParse(extracted);
      if (result) return result;
    }
  }

  // Attempt to repair truncated JSON
  if (cleaned.includes('"chunks": [')) {
    const lastObj = cleaned.lastIndexOf("}");
    if (lastObj !== -1) {
      const repaired = cleaned.slice(0, lastObj + 1) + "]}";
      const result = tryParse(repaired);
      if (result) return result;
    }
  }

  return null;
}

export async function generateChunks(
  articleId: string,
  options?: { modelId?: string; providerId?: string | null }
): Promise<{ success: boolean; count?: number; error?: string }> {
  const supabase = getSupabase();

  const { data: article, error: fetchErr } = await supabase
    .from("knowledge_articles")
    .select("id, title, content, knowledge_base_id")
    .eq("id", articleId)
    .single();

  if (fetchErr || !article) {
    return { success: false, error: fetchErr?.message || "Article not found" };
  }

  if (!article.content || article.content.trim().length === 0) {
    return { success: false, error: "Article has no content" };
  }

  await supabase
    .from("knowledge_articles")
    .update({ chunk_status: "chunking" })
    .eq("id", articleId);

  try {
    const modelId = options?.modelId || "gemini-2.5-flash";
    const { model } = await getModel(modelId, options?.providerId ?? null);

    const prompt = DEFAULT_PROMPT
      .replace("{document_title}", article.title)
      .replace("{content}", article.content);

    let chunks: ChunkResult[] | null = null;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await generateText({
          model,
          prompt,
          maxOutputTokens: 8192,
        });

        chunks = parseChunksResponse(result.text || "");
        if (chunks) break;
      } catch (err) {
        console.error(`Chunk generation attempt ${attempt + 1} failed:`, err);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        }
      }
    }

    if (!chunks || chunks.length === 0) {
      await supabase
        .from("knowledge_articles")
        .update({ chunk_status: "chunk_failed" })
        .eq("id", articleId);
      return { success: false, error: "Failed to parse chunks from LLM response" };
    }

    // Delete old chunks for this article
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("article_id", articleId);

    // Insert new chunks
    const rows = chunks.map((c, i) => ({
      article_id: articleId,
      chunk_text: c.content,
      content_hash: createHash("sha256").update(c.content).digest("hex"),
      embed_status: "pending" as const,
      chunk_index: i,
      metadata: c.metadata,
    }));

    const { error: insertErr } = await supabase
      .from("knowledge_chunks")
      .insert(rows);

    if (insertErr) {
      await supabase
        .from("knowledge_articles")
        .update({ chunk_status: "chunk_failed" })
        .eq("id", articleId);
      return { success: false, error: insertErr.message };
    }

    await supabase
      .from("knowledge_articles")
      .update({ chunk_status: "chunked", chunks_count: rows.length })
      .eq("id", articleId);

    return { success: true, count: rows.length };
  } catch (err) {
    await supabase
      .from("knowledge_articles")
      .update({ chunk_status: "chunk_failed" })
      .eq("id", articleId);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
