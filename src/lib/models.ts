import type { SecretKeyName } from "@/types/database";

export interface ModelDef {
  id: string;
  label: string;
  provider: string;
  requiredKey: SecretKeyName;
}

export const MODEL_CATALOG: ModelDef[] = [
  // Anthropic
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "Anthropic", requiredKey: "ANTHROPIC_API_KEY" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", provider: "Anthropic", requiredKey: "ANTHROPIC_API_KEY" },

  // OpenAI
  { id: "gpt-4o", label: "GPT-4o", provider: "OpenAI", requiredKey: "OPENAI_API_KEY" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI", requiredKey: "OPENAI_API_KEY" },
  { id: "o3-mini", label: "o3-mini", provider: "OpenAI", requiredKey: "OPENAI_API_KEY" },

  // Google
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "Google", requiredKey: "GOOGLE_GENERATIVE_AI_API_KEY" },

  // DeepSeek
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek", requiredKey: "DEEPSEEK_API_KEY" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner", provider: "DeepSeek", requiredKey: "DEEPSEEK_API_KEY" },
];

/**
 * Filter models by which API keys the user has configured.
 * @param configuredKeys - set of key_name strings from the secrets table
 */
export function getAvailableModels(configuredKeys: Set<string>): ModelDef[] {
  return MODEL_CATALOG.filter((m) => configuredKeys.has(m.requiredKey));
}
