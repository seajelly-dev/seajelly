import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import { pcmToWav } from "./pcm-to-wav";
import type { TTSEngine } from "./tts-config-data";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getVoiceApiKey(engine: string): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("voice_api_keys")
    .select("encrypted_value")
    .eq("engine", engine)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!data?.encrypted_value) {
    throw new Error(`No API key configured for engine: ${engine}`);
  }
  return decrypt(data.encrypted_value);
}

export async function getVoiceSettings(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data } = await supabase.from("voice_settings").select("key, value");
  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function generateTTS(opts: {
  text: string;
  engine?: TTSEngine;
  model?: string;
  voice?: string;
}): Promise<{ audioBase64: string; mimeType: string; durationMs: number }> {
  const settings = await getVoiceSettings();
  const engine = opts.engine || (settings.tts_engine as TTSEngine) || "aistudio";
  const model = opts.model || settings.tts_model || "gemini-2.5-flash-preview-tts";
  const voice = opts.voice || settings.tts_voice || "Aoede";
  const cleanText = opts.text.replace(/\*\*|__|\\*|_|`/g, "");
  const startTime = Date.now();

  if (engine === "aistudio") {
    const apiKey = await getVoiceApiKey("aistudio");
    const genAI = new GoogleGenerativeAI(apiKey);
    const aiModel = genAI.getGenerativeModel({ model });

    const result = await aiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: cleanText }] }],
      generationConfig: {
        // @ts-expect-error TTS-specific config not in base types
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });

    const part = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part) throw new Error("No audio data received from AI Studio TTS");

    const pcmBuffer = Buffer.from(part.data!, "base64");
    const audioMimeType = part.mimeType || "";

    let finalBuffer: Buffer;
    let mimeType = "audio/wav";

    if (audioMimeType.startsWith("audio/L16") || audioMimeType.includes("pcm")) {
      finalBuffer = pcmToWav(pcmBuffer, 24000);
    } else {
      finalBuffer = pcmBuffer;
      mimeType = audioMimeType || "audio/wav";
    }

    return {
      audioBase64: finalBuffer.toString("base64"),
      mimeType,
      durationMs: Date.now() - startTime,
    };
  }

  if (engine === "cloud-gemini") {
    const apiKey = await getVoiceApiKey("cloud-gemini");
    const genAI = new GoogleGenerativeAI(apiKey);
    const aiModel = genAI.getGenerativeModel({ model });

    const result = await aiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: cleanText }] }],
      generationConfig: {
        // @ts-expect-error TTS-specific config not in base types
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });

    const part = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part) throw new Error("No audio data received from Cloud Gemini TTS");

    const pcmBuffer = Buffer.from(part.data!, "base64");
    const audioMimeType = part.mimeType || "";

    let finalBuffer: Buffer;
    let mimeType = "audio/wav";

    if (audioMimeType.startsWith("audio/L16") || audioMimeType.includes("pcm")) {
      finalBuffer = pcmToWav(pcmBuffer, 24000);
    } else {
      finalBuffer = pcmBuffer;
      mimeType = audioMimeType || "audio/wav";
    }

    return {
      audioBase64: finalBuffer.toString("base64"),
      mimeType,
      durationMs: Date.now() - startTime,
    };
  }

  throw new Error(`Unsupported TTS engine: ${engine}`);
}

export async function logTTSUsage(opts: {
  agentId?: string;
  channelId?: string;
  engine: string;
  model?: string;
  voice?: string;
  inputText: string;
  durationMs: number;
}) {
  const supabase = getSupabase();
  await supabase.from("tts_usage_logs").insert({
    agent_id: opts.agentId || null,
    channel_id: opts.channelId || null,
    engine: opts.engine,
    model: opts.model || null,
    voice: opts.voice || null,
    input_text: opts.inputText,
    input_length: opts.inputText.length,
    duration_ms: opts.durationMs,
  });
}
