export type TTSEngine = "aistudio" | "cloud-gemini";

export const TTS_ENGINES: Record<TTSEngine, { name: string; description: string }> = {
  aistudio: {
    name: "AI Studio",
    description: "Google AI Studio TTS (free tier, RPD limited)",
  },
  "cloud-gemini": {
    name: "Cloud Gemini",
    description: "Google Cloud TTS (paid, high quality)",
  },
};

export interface TTSModel {
  id: string;
  name: string;
  description: string;
}

export const AISTUDIO_MODELS: TTSModel[] = [
  { id: "gemini-2.5-flash-preview-tts", name: "Flash", description: "Fast response" },
  { id: "gemini-2.5-pro-preview-tts", name: "Pro", description: "High quality" },
];

export const CLOUD_GEMINI_MODELS: TTSModel[] = [
  { id: "gemini-2.5-flash-tts", name: "Flash", description: "Fast response" },
  { id: "gemini-2.5-flash-lite-preview-tts", name: "Flash Lite", description: "Ultra fast" },
  { id: "gemini-2.5-pro-tts", name: "Pro", description: "High quality" },
];

export interface TTSVoice {
  id: string;
  name: string;
  gender?: "male" | "female" | "neutral";
}

export const GEMINI_VOICES: TTSVoice[] = [
  { id: "Zephyr", name: "Zephyr", gender: "neutral" },
  { id: "Puck", name: "Puck", gender: "male" },
  { id: "Charon", name: "Charon", gender: "male" },
  { id: "Kore", name: "Kore", gender: "female" },
  { id: "Fenrir", name: "Fenrir", gender: "male" },
  { id: "Leda", name: "Leda", gender: "female" },
  { id: "Orus", name: "Orus", gender: "male" },
  { id: "Aoede", name: "Aoede", gender: "female" },
  { id: "Callirrhoe", name: "Callirrhoe", gender: "female" },
  { id: "Autonoe", name: "Autonoe", gender: "female" },
  { id: "Enceladus", name: "Enceladus", gender: "male" },
  { id: "Iapetus", name: "Iapetus", gender: "male" },
  { id: "Umbriel", name: "Umbriel", gender: "neutral" },
  { id: "Algieba", name: "Algieba", gender: "male" },
  { id: "Despina", name: "Despina", gender: "female" },
  { id: "Erinome", name: "Erinome", gender: "female" },
  { id: "Algenib", name: "Algenib", gender: "male" },
  { id: "Rasalgethi", name: "Rasalgethi", gender: "male" },
  { id: "Laomedeia", name: "Laomedeia", gender: "female" },
  { id: "Achernar", name: "Achernar", gender: "male" },
  { id: "Alnilam", name: "Alnilam", gender: "male" },
  { id: "Schedar", name: "Schedar", gender: "female" },
  { id: "Gacrux", name: "Gacrux", gender: "male" },
  { id: "Pulcherrima", name: "Pulcherrima", gender: "female" },
  { id: "Achird", name: "Achird", gender: "male" },
  { id: "Zubenelgenubi", name: "Zubenelgenubi", gender: "male" },
  { id: "Vindemiatrix", name: "Vindemiatrix", gender: "female" },
  { id: "Sadachibia", name: "Sadachibia", gender: "male" },
  { id: "Sadaltager", name: "Sadaltager", gender: "male" },
  { id: "Sulafat", name: "Sulafat", gender: "female" },
];

export function getModelsForEngine(engine: TTSEngine): TTSModel[] {
  switch (engine) {
    case "aistudio":
      return AISTUDIO_MODELS;
    case "cloud-gemini":
      return CLOUD_GEMINI_MODELS;
    default:
      return [];
  }
}

export const MAX_CJK_CHARS = 250;
export const MAX_LATIN_CHARS = 500;

export function isTextTooLong(text: string): boolean {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const latinCount = text.length - cjkCount;
  return cjkCount > MAX_CJK_CHARS || latinCount > MAX_LATIN_CHARS;
}
