import { NextRequest, NextResponse } from "next/server";
import { generateTTS, logTTSUsage, getVoiceSettings } from "@/lib/voice/tts-engine";
import { isTextTooLong } from "@/lib/voice/tts-config-data";
import type { TTSEngine } from "@/lib/voice/tts-config-data";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, engine, model, voice, agentId, channelId } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (isTextTooLong(text)) {
      return NextResponse.json(
        { error: "Text too long. Max 250 CJK chars or 500 Latin chars." },
        { status: 400 }
      );
    }

    const settings = await getVoiceSettings();

    const result = await generateTTS({
      text,
      engine: engine as TTSEngine,
      model,
      voice,
    });

    if (agentId) {
      await logTTSUsage({
        agentId,
        channelId,
        engine: engine || settings.tts_engine || "aistudio",
        model: model || settings.tts_model,
        voice: voice || settings.tts_voice,
        inputText: text,
        durationMs: result.durationMs,
      });
    }

    return NextResponse.json({
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
      durationMs: result.durationMs,
    });
  } catch (err) {
    console.error("TTS generation error:", err);
    const message = err instanceof Error ? err.message : "TTS generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
