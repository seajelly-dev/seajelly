import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { ImageGenProvider } from "./config-data";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function getImageGenApiKey(engine: string): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("voice_api_keys")
    .select("encrypted_value")
    .eq("engine", engine)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!data?.encrypted_value) {
    throw new Error(`No API key configured for image generation engine: ${engine}`);
  }
  return decrypt(data.encrypted_value);
}

export async function getImageGenSettings(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("voice_settings")
    .select("key, value")
    .like("key", "image_gen_%");
  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export interface ImageGenResult {
  imageBase64: string;
  mimeType: string;
  textResponse: string;
  durationMs: number;
}

/**
 * Unified image generation / editing via Gemini native image output.
 * - Text-to-image: provide `prompt` only.
 * - Image editing: provide `prompt` + `sourceImageBase64` (+ optional `sourceMimeType`).
 */
export async function generateImage(opts: {
  prompt: string;
  sourceImageBase64?: string;
  sourceMimeType?: string;
  model?: string;
  provider?: ImageGenProvider;
}): Promise<ImageGenResult> {
  const settings = await getImageGenSettings();
  const provider = opts.provider || (settings.image_gen_provider as ImageGenProvider) || "google";
  const model = opts.model || settings.image_gen_model || "gemini-3.1-flash-image-preview";
  const startTime = Date.now();

  if (provider === "google") {
    const apiKey = await getImageGenApiKey("google-image-gen");
    const ai = new GoogleGenAI({ apiKey });

    const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (opts.sourceImageBase64) {
      contentParts.push({
        inlineData: {
          mimeType: opts.sourceMimeType || "image/png",
          data: opts.sourceImageBase64,
        },
      });
    }

    contentParts.push({ text: opts.prompt });

    const response = await ai.models.generateContent({
      model,
      contents: contentParts,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts?.length) {
      throw new Error("No response received from image generation model");
    }

    let imageBase64 = "";
    let mimeType = "image/png";
    let textResponse = "";

    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data!;
        mimeType = part.inlineData.mimeType || "image/png";
      } else if (part.text) {
        textResponse += part.text;
      }
    }

    if (!imageBase64) {
      throw new Error("No image data in the response. The model may have refused the prompt.");
    }

    return {
      imageBase64,
      mimeType,
      textResponse,
      durationMs: Date.now() - startTime,
    };
  }

  throw new Error(`Unsupported image generation provider: ${provider}`);
}
