interface KnowledgeImageSearchResult {
  success: boolean;
  matched?: boolean;
  title?: string;
  similarity?: number;
  content?: string;
  error?: string;
}

async function resolveImageBase64FromUrl(
  url: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const resolvedMime = res.headers.get("content-type") || "image/jpeg";
    return { base64: buf.toString("base64"), mimeType: resolvedMime };
  } catch {
    return null;
  }
}

export async function runKnowledgeImageSearch(params: {
  agentId: string;
  imageUrl: string | null;
}): Promise<KnowledgeImageSearchResult> {
  const { agentId, imageUrl } = params;

  if (!imageUrl) {
    return { success: false, error: "No image URL provided. Pass an image_url or ensure this turn has an image." };
  }

  const resolved = await resolveImageBase64FromUrl(imageUrl);
  if (!resolved) {
    return { success: false, error: "Failed to download image from URL." };
  }

  const { normalizeImageForEmbedding } = await import("@/lib/memory/image-normalize");
  const normalized = await normalizeImageForEmbedding(resolved.base64, resolved.mimeType);
  if (!normalized) {
    return { success: false, error: `Unsupported image format: ${resolved.mimeType}` };
  }

  const approxBytes = Math.floor((normalized.base64.length * 3) / 4);
  if (approxBytes > 8 * 1024 * 1024) {
    return { success: false, error: "Image too large for embedding (max 8MB)." };
  }

  const {
    getAgentKnowledgeBaseIds,
    getMediaMatchThreshold,
    hasAgentMediaEmbeddings,
    searchArticleByMedia,
  } = await import("@/lib/knowledge/search");

  const hasMedia = await hasAgentMediaEmbeddings(agentId);
  if (!hasMedia) {
    return { success: false, error: "No media embeddings found in the agent's knowledge bases." };
  }

  const threshold = await getMediaMatchThreshold();
  const { embedContent } = await import("@/lib/memory/embedding");

  const queryVec = await embedContent(
    [{ inlineData: { mimeType: normalized.mimeType, data: normalized.base64 } }],
    "gemini-embedding-2-preview",
    "RETRIEVAL_QUERY",
  );

  if (!queryVec) {
    return { success: false, error: "Failed to generate image embedding." };
  }

  const agentKbIds = await getAgentKnowledgeBaseIds(agentId);
  const topArticle = await searchArticleByMedia(queryVec, agentKbIds, 1, threshold);

  if (!topArticle) {
    return { success: true, matched: false };
  }

  return {
    success: true,
    matched: true,
    title: topArticle.title,
    similarity: Math.round(topArticle.similarity * 1000) / 1000,
    content: topArticle.content,
  };
}
