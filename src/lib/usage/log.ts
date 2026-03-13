import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
}

export interface LogApiUsageParams {
  supabase?: SupabaseClient;
  agentId?: string | null;
  providerId?: string | null;
  modelId: string;
  keyId?: string | null;
  durationMs?: number | null;
  usage?: unknown;
}

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function extractUsageMetrics(usage: unknown): UsageMetrics {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: 0, outputTokens: 0 };
  }

  const rec = usage as Record<string, unknown>;
  return {
    inputTokens: typeof rec.inputTokens === "number" ? rec.inputTokens : 0,
    outputTokens: typeof rec.outputTokens === "number" ? rec.outputTokens : 0,
  };
}

export function readGenerateTextUsage(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const rec = result as Record<string, unknown>;
  return rec.totalUsage ?? rec.usage;
}

export async function logApiUsage(params: LogApiUsageParams): Promise<void> {
  const { supabase, agentId, providerId, modelId, keyId, durationMs, usage } = params;
  const db = supabase ?? getSupabase();
  const metrics = extractUsageMetrics(usage);

  const { error } = await db.from("api_usage_logs").insert({
    agent_id: agentId ?? null,
    provider_id: providerId ?? null,
    model_id: modelId,
    key_id: keyId ?? null,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    duration_ms: durationMs ?? null,
  });

  if (error) {
    console.warn("[usage] api_usage_logs insert failed:", error);
  }
}
