import { createClient } from "@supabase/supabase-js";
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

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = await getSecret("EMBEDDING_API_KEY");
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
        }),
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding?.values ?? null;
  } catch {
    return null;
  }
}

export async function storeChunks(memoryId: string, text: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const chunks = chunkText(text);

  for (const chunk of chunks) {
    const hash = contentHash(chunk);

    const { data: existing } = await supabase
      .from("memory_chunks")
      .select("id")
      .eq("content_hash", hash)
      .maybeSingle();

    if (existing) continue;

    const embedding = await embedText(chunk);

    await supabase.from("memory_chunks").insert({
      memory_id: memoryId,
      chunk_text: chunk,
      embedding,
      content_hash: hash,
      embed_model: embedding ? "gemini-embedding-001" : null,
      status: embedding ? "embedded" : "pending_embedded",
    });
  }
}
