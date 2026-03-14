import type { SupabaseClient } from "@supabase/supabase-js";

interface RunImageKnowledgeBypassParams {
  supabase: SupabaseClient;
  traceId: string;
  eventId: string | null;
  agentId: string;
  channelId: string | null;
  sessionId: string;
  imageBase64ForMediaSearch: string | null;
  imageMimeForMediaSearch: string | null;
  imageUrlForMediaSearch: string | null;
  hasImageInput: boolean;
  hasEmbeddingApiKey: boolean;
  canImageKnowledgeSearchByModel: boolean;
  tools: Record<string, unknown>;
  trimPayload: (input: unknown) => unknown;
  deps?: Partial<{
    normalizeImageForEmbedding: (
      base64: string,
      mimeType: string,
    ) => Promise<{
      base64: string;
      mimeType: string;
      converted: boolean;
    } | null>;
    hasAgentMediaEmbeddings: (agentId: string) => Promise<boolean>;
    getMediaMatchThreshold: () => Promise<number>;
    embedContent: (
      parts: Array<{ inlineData: { mimeType: string; data: string } }>,
      model: string,
      taskType: string,
    ) => Promise<number[] | null>;
    getAgentKnowledgeBaseIds: (agentId: string) => Promise<string[]>;
    searchArticleByMedia: (
      queryVec: number[],
      knowledgeBaseIds: string[],
      limit: number,
      threshold: number,
    ) => Promise<{
      id: string;
      title: string;
      content: string;
      similarity: number;
    } | null>;
  }>;
}

async function resolveImageBase64(
  base64: string | null,
  url: string | null,
  mime: string | null,
): Promise<{ base64: string; mimeType: string } | null> {
  if (base64 && mime) return { base64, mimeType: mime };
  if (url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const resolvedMime = res.headers.get("content-type") || mime || "image/jpeg";
      return { base64: buf.toString("base64"), mimeType: resolvedMime };
    } catch {
      return null;
    }
  }
  return null;
}

export async function runImageKnowledgeBypass(
  params: RunImageKnowledgeBypassParams,
): Promise<{ promptAppendix: string }> {
  const {
    supabase,
    traceId,
    eventId,
    agentId,
    channelId,
    sessionId,
    imageBase64ForMediaSearch,
    imageMimeForMediaSearch,
    imageUrlForMediaSearch,
    hasImageInput,
    hasEmbeddingApiKey,
    canImageKnowledgeSearchByModel,
    tools,
    trimPayload,
    deps,
  } = params;

  const canImageKnowledgeSearchThisTurn =
    hasImageInput &&
    hasEmbeddingApiKey &&
    canImageKnowledgeSearchByModel &&
    Object.prototype.hasOwnProperty.call(tools, "knowledge_search");

  const hasAnyImageSource = !!(imageBase64ForMediaSearch || imageUrlForMediaSearch);
  if (!canImageKnowledgeSearchThisTurn || !hasAnyImageSource) {
    return { promptAppendix: "" };
  }

  const mediaSearchStartedAt = Date.now();
  let mediaStepStatus: "success" | "failed" = "success";
  let mediaStepError: string | null = null;
  let mediaStepOutput: Record<string, unknown> = { outcome: "not_started" };
  let promptAppendix = "";

  try {
    const resolved = await resolveImageBase64(
      imageBase64ForMediaSearch,
      imageUrlForMediaSearch,
      imageMimeForMediaSearch,
    );
    if (!resolved) {
      mediaStepOutput = { outcome: "skipped_no_image_data" };
      return { promptAppendix: "" };
    }

    const rawApproxBytes = Math.floor((resolved.base64.length * 3) / 4);

    const normalizeImageForEmbedding =
      deps?.normalizeImageForEmbedding ??
      (await import("@/lib/memory/image-normalize")).normalizeImageForEmbedding;
    const normalized = await normalizeImageForEmbedding(resolved.base64, resolved.mimeType);
    if (!normalized) {
      mediaStepOutput = {
        outcome: "skipped_unsupported_mime",
        sourceMime: resolved.mimeType,
      };
      console.warn(
        `[agent-loop] trace=${traceId} skip media-search: unsupported image mime=${resolved.mimeType}`,
      );
    } else {
      const approxBytes = Math.floor((normalized.base64.length * 3) / 4);
      if (approxBytes > 8 * 1024 * 1024) {
        mediaStepOutput = {
          outcome: "skipped_too_large",
          normalizedMime: normalized.mimeType,
          bytes: approxBytes,
        };
        console.warn(
          `[agent-loop] trace=${traceId} skip media-search: image too large (${approxBytes} bytes, mime=${normalized.mimeType})`,
        );
      } else {
        const searchDeps =
          deps?.getAgentKnowledgeBaseIds &&
          deps?.getMediaMatchThreshold &&
          deps?.hasAgentMediaEmbeddings &&
          deps?.searchArticleByMedia
            ? {
                getAgentKnowledgeBaseIds: deps.getAgentKnowledgeBaseIds,
                getMediaMatchThreshold: deps.getMediaMatchThreshold,
                hasAgentMediaEmbeddings: deps.hasAgentMediaEmbeddings,
                searchArticleByMedia: deps.searchArticleByMedia,
              }
            : await import("@/lib/knowledge/search");
        const {
          getAgentKnowledgeBaseIds,
          getMediaMatchThreshold,
          hasAgentMediaEmbeddings,
          searchArticleByMedia,
        } = searchDeps;
        const hasMedia = await hasAgentMediaEmbeddings(agentId);
        if (!hasMedia) {
          mediaStepOutput = { outcome: "skipped_no_media_embeddings" };
        } else {
          const threshold = await getMediaMatchThreshold();
          const embedContent =
            deps?.embedContent ??
            (await import("@/lib/memory/embedding")).embedContent;
          if (normalized.converted) {
            console.log(
              `[agent-loop] trace=${traceId} media-search image converted for embedding: ${resolved.mimeType} -> ${normalized.mimeType}`,
            );
          }
          console.log(
            `[agent-loop] trace=${traceId} media-search query embedding: mime=${normalized.mimeType} bytes≈${approxBytes} threshold=${threshold}`,
          );
          const queryVec = await embedContent(
            [{ inlineData: { mimeType: normalized.mimeType, data: normalized.base64 } }],
            "gemini-embedding-2-preview",
            "RETRIEVAL_QUERY",
          );
          if (queryVec) {
            const agentKbIds = await getAgentKnowledgeBaseIds(agentId);
            const topArticle = await searchArticleByMedia(queryVec, agentKbIds, 1, threshold);
            if (topArticle) {
              mediaStepOutput = {
                outcome: "hit",
                threshold,
                similarity: topArticle.similarity,
                articleId: topArticle.id,
                articleTitle: topArticle.title,
              };
              console.log(
                `[agent-loop] trace=${traceId} media-search hit: "${topArticle.title}" sim=${topArticle.similarity.toFixed(3)} threshold=${threshold}`,
              );
              promptAppendix += "\n\n## Image Search Result\n";
              promptAppendix +=
                "The user's image was matched against the knowledge base via vector similarity. ";
              promptAppendix += `Top match: "${topArticle.title}" (similarity: ${topArticle.similarity.toFixed(3)}).\n\n`;
              promptAppendix +=
                "**Your task**: Compare what you see in the image with the article below. ";
              promptAppendix +=
                "If they clearly refer to the same subject, use the article as your PRIMARY source to answer. ";
              promptAppendix +=
                "If the image does NOT match (false positive), IGNORE this section entirely and respond based on the image alone.\n\n";
              promptAppendix += `### ${topArticle.title}\n${topArticle.content}\n`;
            } else {
              mediaStepOutput = {
                outcome: "no_hit_above_threshold",
                threshold,
              };
              console.log(`[agent-loop] trace=${traceId} media-search no hit above threshold=${threshold}`);
            }
          } else {
            mediaStepStatus = "failed";
            mediaStepError = "Failed to embed media query";
            mediaStepOutput = {
              outcome: "query_embedding_failed",
              normalizedMime: normalized.mimeType,
              threshold,
            };
            console.warn(
              `[agent-loop] trace=${traceId} media-search query embedding failed: mime=${normalized.mimeType}`,
            );
          }
        }
      }
    }

    mediaStepOutput = { ...mediaStepOutput, sourceBytesApprox: rawApproxBytes };
  } catch (err) {
    mediaStepStatus = "failed";
    mediaStepError = err instanceof Error ? err.message : "Media search bypass exception";
    mediaStepOutput = { outcome: "exception" };
    console.warn("[agent-loop] media search bypass error (non-blocking):", err);
  } finally {
    try {
      await supabase.from("agent_step_logs").insert({
        trace_id: traceId,
        event_id: eventId,
        agent_id: agentId,
        channel_id: channelId,
        session_id: sessionId,
        step_no: 0,
        phase: "tool",
        tool_name: "media_search_bypass",
        tool_input_json: trimPayload({
          sourceMime: imageMimeForMediaSearch,
          sourceUrl: imageUrlForMediaSearch ? "[present]" : null,
          hasBase64: !!imageBase64ForMediaSearch,
        }),
        tool_output_json: trimPayload(mediaStepOutput),
        model_text: "",
        status: mediaStepStatus,
        error_message: mediaStepError,
        latency_ms: Math.max(0, Date.now() - mediaSearchStartedAt),
      });
    } catch {
      // non-blocking
    }
  }

  return { promptAppendix };
}
