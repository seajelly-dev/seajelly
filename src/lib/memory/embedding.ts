import { createHash } from "crypto";
import { getSecret } from "@/lib/secrets";

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

export function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  if (words.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    chunks.push(chunk);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function resolveEmbeddingApiKey(): Promise<string | null> {
  const secretKey = await getSecret("EMBEDDING_API_KEY");
  return secretKey?.trim() ? secretKey : null;
}

export async function hasEmbeddingApiKey(): Promise<boolean> {
  const apiKey = await resolveEmbeddingApiKey();
  return Boolean(apiKey);
}

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedText(
  text: string,
  model = "gemini-embedding-001",
  taskType: EmbedTaskType = "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  return embedContent([{ text }], model, taskType);
}

export type EmbedContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function embedContent(
  parts: EmbedContentPart[],
  model = "gemini-embedding-2-preview",
  taskType: EmbedTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[] | null> {
  const apiKey = await resolveEmbeddingApiKey();
  if (!apiKey) {
    console.error("[embedContent] No embedding API key found. Set EMBEDDING_API_KEY in secrets.");
    return null;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts },
          taskType,
          outputDimensionality: 1536,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[embedContent] Gemini API error ${res.status}: ${errText}`);
      return null;
    }
    const data = await res.json();
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error("[embedContent] Exception:", err);
    return null;
  }
}
