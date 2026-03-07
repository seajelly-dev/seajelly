import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getSecret } from "@/lib/secrets";
import type { LanguageModel } from "ai";

export async function getModel(modelId: string): Promise<LanguageModel> {
  if (modelId.startsWith("claude")) {
    const apiKey = await getSecret("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId);
  }

  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
    const apiKey = await getSecret("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
    const openai = createOpenAI({ apiKey });
    return openai(modelId);
  }

  if (modelId.startsWith("gemini")) {
    const apiKey = await getSecret("GOOGLE_GENERATIVE_AI_API_KEY");
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured");
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }

  if (modelId.startsWith("deepseek")) {
    const apiKey = await getSecret("DEEPSEEK_API_KEY");
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured");
    const openai = createOpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
    });
    return openai(modelId);
  }

  throw new Error(`Unsupported model: ${modelId}`);
}
