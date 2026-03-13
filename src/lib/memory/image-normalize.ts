const EMBED_NATIVE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg"]);

export interface NormalizedEmbeddingImage {
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  converted: boolean;
}

function normalizeMime(mimeType: string): string {
  return (mimeType || "").toLowerCase().split(";")[0].trim();
}

export async function normalizeImageForEmbedding(
  base64: string,
  mimeType: string,
): Promise<NormalizedEmbeddingImage | null> {
  const normalizedMime = normalizeMime(mimeType);
  if (!normalizedMime.startsWith("image/")) return null;

  if (EMBED_NATIVE_IMAGE_MIME.has(normalizedMime)) {
    return {
      base64,
      mimeType: normalizedMime === "image/jpg" ? "image/jpeg" : (normalizedMime as "image/png" | "image/jpeg"),
      converted: false,
    };
  }

  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const input = Buffer.from(base64, "base64");

    // Convert non-native image formats (e.g. webp/gif/bmp) to PNG for embedding.
    const output = await sharp(input, { animated: false }).png().toBuffer();
    return {
      base64: output.toString("base64"),
      mimeType: "image/png",
      converted: true,
    };
  } catch (err) {
    console.warn(`[normalizeImageForEmbedding] convert failed: mime=${normalizedMime}`, err);
    return null;
  }
}

