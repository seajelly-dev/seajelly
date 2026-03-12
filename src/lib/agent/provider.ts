import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import type { LanguageModel } from "ai";
import type { ProviderType } from "@/types/database";

const BUILTIN_BASE_URLS: Record<string, string | undefined> = {
  deepseek: "https://api.deepseek.com",
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Rate-limit / overload detection ──

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /high.?demand/i,
  /overloaded/i,
  /capacity/i,
  /quota.?exceeded/i,
  /too.?many.?requests/i,
  /server.?overloaded/i,
  /resource.?exhausted/i,
];

export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERNS.some((p) => p.test(msg));
}

// ── Cooldown management ──

const COOLDOWN_RATE_LIMIT_MS = 5 * 60 * 1000;
const COOLDOWN_HIGH_DEMAND_MS = 3 * 60 * 1000;

export function getCooldownDuration(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error);
  if (/rate.?limit|\b429\b|too.?many.?requests|quota.?exceeded/i.test(msg)) {
    return COOLDOWN_RATE_LIMIT_MS;
  }
  if (/high.?demand|overloaded|capacity|server.?overloaded|resource.?exhausted/i.test(msg)) {
    return COOLDOWN_HIGH_DEMAND_MS;
  }
  return 0;
}

export async function markKeyCooldown(
  keyId: string,
  reason: string,
  durationMs: number,
): Promise<void> {
  if (!keyId || durationMs <= 0) return;
  const supabase = getSupabase();
  const until = new Date(Date.now() + durationMs).toISOString();
  await supabase
    .from("provider_api_keys")
    .update({ cooldown_until: until, cooldown_reason: reason })
    .eq("id", keyId)
    .then(() => {}, () => {});
}

// ── Weighted random key selection with cooldown filtering ──

interface PickedKey {
  keyId: string;
  apiKey: string;
}

type PickApiKeyResult =
  | { status: "picked"; picked: PickedKey }
  | { status: "no_active_keys" }
  | { status: "all_cooling"; nextReadyAt: string | null }
  | { status: "invalid_keys" };

async function pickApiKey(providerId: string): Promise<PickApiKeyResult> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: keys } = await supabase
    .from("provider_api_keys")
    .select("id, encrypted_value, call_count, weight, cooldown_until")
    .eq("provider_id", providerId)
    .eq("is_active", true);

  if (!keys || keys.length === 0) return { status: "no_active_keys" };

  const available = keys.filter(
    (k) => !k.cooldown_until || k.cooldown_until < now,
  );
  if (available.length === 0) {
    const nextReadyAt = keys
      .map((k) => k.cooldown_until)
      .filter((v): v is string => !!v)
      .sort()[0] ?? null;
    return { status: "all_cooling", nextReadyAt };
  }

  const totalWeight = available.reduce((sum, k) => sum + (k.weight ?? 1), 0);
  let roll = Math.random() * totalWeight;
  let picked = available[0];
  for (const k of available) {
    roll -= k.weight ?? 1;
    if (roll <= 0) {
      picked = k;
      break;
    }
  }

  const ordered = [picked, ...available.filter((k) => k.id !== picked.id)];
  for (const candidate of ordered) {
    try {
      const apiKey = decrypt(candidate.encrypted_value);
      supabase
        .from("provider_api_keys")
        .update({ call_count: (candidate.call_count ?? 0) + 1 })
        .eq("id", candidate.id)
        .then(() => {}, () => {});
      return { status: "picked", picked: { keyId: candidate.id, apiKey } };
    } catch {
      // try next key
    }
  }
  return { status: "invalid_keys" };
}

// ── Model creation ──

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
      return openai.chat(modelId);
    }
    case "openai_compatible": {
      if (!baseUrl) throw new Error("base_url required for openai_compatible provider");
      const openai = createOpenAI({ apiKey, baseURL: baseUrl });
      return openai.chat(modelId);
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

// ── Public API ──

export interface GetModelResult {
  model: LanguageModel;
  resolvedProviderId: string | null;
  pickedKeyId: string | null;
}

export async function getModel(
  modelId: string,
  providerId?: string | null,
): Promise<GetModelResult> {
  const supabase = getSupabase();

  if (providerId) {
    const { data: provider } = await supabase
      .from("providers")
      .select("id, type, base_url, enabled")
      .eq("id", providerId)
      .eq("enabled", true)
      .single();

    if (provider) {
      const picked = await pickApiKey(provider.id);
      if (picked.status === "picked") {
        return {
          model: createModelFromType(provider.type as ProviderType, picked.picked.apiKey, modelId, provider.base_url),
          resolvedProviderId: provider.id,
          pickedKeyId: picked.picked.keyId,
        };
      }
      if (picked.status === "all_cooling") {
        throw new Error(
          `All API keys are cooling down for provider: ${provider.type}${picked.nextReadyAt ? ` until ${picked.nextReadyAt}` : ""}`,
        );
      }
      if (picked.status === "invalid_keys") {
        throw new Error(`API keys are configured but invalid for provider: ${provider.type}`);
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
    const picked = await pickApiKey(matchingProvider.id);
    if (picked.status === "picked") {
      return {
        model: createModelFromType(matchingProvider.type as ProviderType, picked.picked.apiKey, modelId, matchingProvider.base_url),
        resolvedProviderId: matchingProvider.id,
        pickedKeyId: picked.picked.keyId,
      };
    }
    if (picked.status === "all_cooling") {
      throw new Error(
        `All API keys are cooling down for model: ${modelId}${picked.nextReadyAt ? ` until ${picked.nextReadyAt}` : ""}`,
      );
    }
    if (picked.status === "invalid_keys") {
      throw new Error(`API keys are configured but invalid for model: ${modelId}`);
    }
  }

  throw new Error(`No API key configured for model: ${modelId}`);
}
