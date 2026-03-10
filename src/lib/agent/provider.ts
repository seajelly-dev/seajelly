import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { LanguageModel } from "ai";
import type { ProviderType } from "@/types/database";

const BUILTIN_BASE_URLS: Record<string, string | undefined> = {
  deepseek: "https://api.deepseek.com/v1",
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function pickApiKey(providerId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data: keys } = await supabase
    .from("provider_api_keys")
    .select("id, encrypted_value, call_count")
    .eq("provider_id", providerId)
    .eq("is_active", true);

  if (!keys || keys.length === 0) return null;

  const picked = keys[Math.floor(Math.random() * keys.length)];
  try {
    const apiKey = decrypt(picked.encrypted_value);
    supabase
      .from("provider_api_keys")
      .update({ call_count: (picked.call_count ?? 0) + 1 })
      .eq("id", picked.id)
      .then(() => {}, () => {});
    return apiKey;
  } catch {
    return null;
  }
}

function createModelFromType(
  type: ProviderType,
  apiKey: string,
  modelId: string,
  baseUrl?: string | null,
): LanguageModel {
  switch (type) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    case "deepseek": {
      const openai = createOpenAI({
        apiKey,
        baseURL: baseUrl || BUILTIN_BASE_URLS.deepseek!,
      });
      return openai(modelId);
    }
    case "openai_compatible": {
      if (!baseUrl) throw new Error("base_url required for openai_compatible provider");
      const openai = createOpenAI({ apiKey, baseURL: baseUrl });
      return openai(modelId);
    }
    default:
      throw new Error(`Unsupported provider type: ${type}`);
  }
}

function inferProviderType(modelId: string): ProviderType {
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) return "openai";
  if (modelId.startsWith("gemini")) return "google";
  if (modelId.startsWith("deepseek")) return "deepseek";
  return "openai";
}

export async function getModel(
  modelId: string,
  providerId?: string | null,
): Promise<{ model: LanguageModel; resolvedProviderId: string | null }> {
  const supabase = getSupabase();

  if (providerId) {
    const { data: provider } = await supabase
      .from("providers")
      .select("id, type, base_url, enabled")
      .eq("id", providerId)
      .eq("enabled", true)
      .single();

    if (provider) {
      const apiKey = await pickApiKey(provider.id);
      if (apiKey) {
        return {
          model: createModelFromType(provider.type as ProviderType, apiKey, modelId, provider.base_url),
          resolvedProviderId: provider.id,
        };
      }
      throw new Error(`No API key configured for provider: ${provider.type}`);
    }
  }

  const inferredType = inferProviderType(modelId);

  const { data: matchingProvider } = await supabase
    .from("providers")
    .select("id, type, base_url")
    .eq("type", inferredType)
    .eq("is_builtin", true)
    .eq("enabled", true)
    .single();

  if (matchingProvider) {
    const apiKey = await pickApiKey(matchingProvider.id);
    if (apiKey) {
      return {
        model: createModelFromType(matchingProvider.type as ProviderType, apiKey, modelId, matchingProvider.base_url),
        resolvedProviderId: matchingProvider.id,
      };
    }
  }

  throw new Error(`No API key configured for model: ${modelId}`);
}
