import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { decrypt } from "@/lib/crypto/encrypt";
import { getSecret } from "@/lib/secrets";

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

const GOOGLE_PROVIDER_ID = "00000000-0000-0000-0000-000000000003";

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
  // 1) secrets 表的 EMBEDDING_API_KEY
  const secretKey = await getSecret("EMBEDDING_API_KEY");
  if (secretKey) return secretKey;

  // 2) provider_api_keys 表的 Google provider key
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: keys } = await supabase
      .from("provider_api_keys")
      .select("encrypted_value")
      .eq("provider_id", GOOGLE_PROVIDER_ID)
      .eq("is_active", true)
      .limit(1);

    if (keys && keys.length > 0) {
      return decrypt(keys[0].encrypted_value);
    }
  } catch (err) {
    console.error("[embedText] Failed to read Google provider key:", err);
  }

  return null;
}

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedText(
  text: string,
  model = "gemini-embedding-001",
  taskType: EmbedTaskType = "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  const apiKey = await resolveEmbeddingApiKey();
  if (!apiKey) {
    console.error("[embedText] No embedding API key found. Set EMBEDDING_API_KEY in secrets or add a Google provider key.");
    return null;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: 1536,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[embedText] Gemini API error ${res.status}: ${errText}`);
      return null;
    }
    const data = await res.json();
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error("[embedText] Exception:", err);
    return null;
  }
}
