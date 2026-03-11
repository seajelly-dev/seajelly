import { createClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/memory/embedding";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export interface KnowledgeSearchResult {
  id: string;
  article_id: string;
  chunk_text: string;
  similarity: number;
  article_title: string;
  knowledge_base_name: string;
}

export interface ArticleContext {
  article_id: string;
  title: string;
  content: string;
  knowledge_base_name: string;
  max_similarity: number;
  matched_chunks: number;
}

export interface KnowledgeSearchWithArticlesResult {
  success: boolean;
  chunks: KnowledgeSearchResult[];
  articles: ArticleContext[];
  error?: string;
}

interface SearchOptions {
  query: string;
  topK?: number;
  threshold?: number;
  kbIds?: string[] | null;
}

export async function searchKnowledge(
  options: SearchOptions
): Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }> {
  const { query, topK = 10, threshold = 0.5, kbIds = null } = options;

  const queryEmbedding = await embedText(query, "gemini-embedding-001", "RETRIEVAL_QUERY");
  if (!queryEmbedding) {
    return { success: false, results: [], error: "Failed to embed query text" };
  }

  const supabase = getSupabase();

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embeddingStr,
    match_threshold: threshold,
    match_count: topK,
    kb_ids: kbIds && kbIds.length > 0 ? kbIds : null,
  });

  if (error) {
    return { success: false, results: [], error: error.message };
  }

  const results: KnowledgeSearchResult[] = (data ?? []).map(
    (row: Record<string, unknown>) => ({
      id: row.id as string,
      article_id: row.article_id as string,
      chunk_text: row.chunk_text as string,
      similarity: row.similarity as number,
      article_title: row.article_title as string,
      knowledge_base_name: row.knowledge_base_name as string,
    })
  );

  return { success: true, results };
}

/**
 * Chunk retrieval → deduplicate article_ids → fetch full article content.
 * Returns both the ranked chunks (for transparency) and the merged full articles (for LLM context).
 */
export async function searchKnowledgeWithArticles(
  options: SearchOptions
): Promise<KnowledgeSearchWithArticlesResult> {
  const chunkResult = await searchKnowledge(options);
  if (!chunkResult.success || chunkResult.results.length === 0) {
    return { success: chunkResult.success, chunks: [], articles: [], error: chunkResult.error };
  }

  const chunks = chunkResult.results;

  const articleMap = new Map<string, { title: string; kb_name: string; maxSim: number; count: number }>();
  for (const c of chunks) {
    const existing = articleMap.get(c.article_id);
    if (!existing) {
      articleMap.set(c.article_id, {
        title: c.article_title,
        kb_name: c.knowledge_base_name,
        maxSim: c.similarity,
        count: 1,
      });
    } else {
      existing.maxSim = Math.max(existing.maxSim, c.similarity);
      existing.count++;
    }
  }

  const articleIds = [...articleMap.keys()];

  const supabase = getSupabase();
  const { data: articleRows } = await supabase
    .from("knowledge_articles")
    .select("id, title, content")
    .in("id", articleIds);

  const articles: ArticleContext[] = (articleRows ?? [])
    .map((row) => {
      const meta = articleMap.get(row.id)!;
      return {
        article_id: row.id as string,
        title: row.title as string,
        content: row.content as string,
        knowledge_base_name: meta.kb_name,
        max_similarity: meta.maxSim,
        matched_chunks: meta.count,
      };
    })
    .sort((a, b) => b.max_similarity - a.max_similarity);

  return { success: true, chunks, articles };
}

export async function searchKnowledgeForAgent(
  agentId: string,
  query: string,
  topK = 10
): Promise<KnowledgeSearchWithArticlesResult> {
  const supabase = getSupabase();

  const { data: kbRows } = await supabase
    .from("agent_knowledge_bases")
    .select("knowledge_base_id")
    .eq("agent_id", agentId);

  const kbIds = (kbRows ?? []).map((r) => r.knowledge_base_id as string);

  if (kbIds.length === 0) {
    return { success: false, chunks: [], articles: [], error: "No knowledge bases mounted on this agent" };
  }

  return searchKnowledgeWithArticles({ query, topK, kbIds });
}
