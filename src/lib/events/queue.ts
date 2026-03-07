import { createClient } from "@supabase/supabase-js";
import type { AgentEvent } from "@/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const LOCK_DURATION_SECONDS = 120;
const BATCH_SIZE = 5;

export async function claimPendingEvents(): Promise<AgentEvent[]> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: pending } = await supabase
    .from("events")
    .select("id")
    .or(`status.eq.pending,and(status.eq.processing,locked_until.lt.${now})`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!pending || pending.length === 0) return [];

  const ids = pending.map((e) => e.id);
  const lockedUntil = new Date(
    Date.now() + LOCK_DURATION_SECONDS * 1000
  ).toISOString();

  const { data: claimed } = await supabase
    .from("events")
    .update({
      status: "processing",
      locked_until: lockedUntil,
    })
    .in("id", ids)
    .select("*");

  return (claimed as AgentEvent[]) ?? [];
}

export async function markProcessed(eventId: string) {
  const supabase = getSupabase();
  await supabase
    .from("events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);
}

export async function markFailed(eventId: string, errorMessage: string) {
  const supabase = getSupabase();

  const { data: event } = await supabase
    .from("events")
    .select("retry_count, max_retries")
    .eq("id", eventId)
    .single();

  if (!event) return;

  const newRetryCount = (event.retry_count ?? 0) + 1;
  const isDead = newRetryCount >= (event.max_retries ?? 5);

  await supabase
    .from("events")
    .update({
      status: isDead ? "dead" : "failed",
      retry_count: newRetryCount,
      error_message: errorMessage,
      locked_until: isDead
        ? null
        : new Date(Date.now() + backoffMs(newRetryCount)).toISOString(),
    })
    .eq("id", eventId);
}

function backoffMs(retryCount: number): number {
  const base = [10_000, 30_000, 120_000, 600_000, 1_800_000];
  return base[Math.min(retryCount - 1, base.length - 1)];
}
