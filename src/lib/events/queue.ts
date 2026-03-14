import { createClient } from "@supabase/supabase-js";
import type { AgentEvent } from "@/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Lock covers agent wall time (275s) + buffer, but expires before
// Vercel's 300s hard kill so zombies become reclaimable almost immediately.
const LOCK_DURATION_SECONDS = 295;
const BATCH_SIZE = 5;

export async function claimEventById(
  eventId: string,
  supabase = getSupabase(),
): Promise<AgentEvent | null> {
  const lockedUntil = new Date(
    Date.now() + LOCK_DURATION_SECONDS * 1000
  ).toISOString();

  const { data: claimed } = await supabase
    .from("events")
    .update({ status: "processing", locked_until: lockedUntil })
    .eq("id", eventId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  return (claimed as AgentEvent) ?? null;
}

export async function claimPendingEvents(
  supabase = getSupabase(),
): Promise<AgentEvent[]> {
  const now = new Date().toISOString();

  const { data: pending } = await supabase
    .from("events")
    .select("id, status, retry_count, max_retries, locked_until")
    .or(
      `status.eq.pending,and(status.eq.processing,locked_until.lt.${now}),and(status.eq.failed,locked_until.lt.${now})`,
    )
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!pending || pending.length === 0) return [];

  const lockedUntil = new Date(
    Date.now() + LOCK_DURATION_SECONDS * 1000
  ).toISOString();

  const results: AgentEvent[] = [];

  for (const row of pending) {
    const wasZombie = row.status === "processing";
    const retryCount = (row.retry_count ?? 0) + (wasZombie ? 1 : 0);
    const maxRetries = row.max_retries ?? 5;

    if (retryCount >= maxRetries) {
      await supabase
        .from("events")
        .update({
          status: "dead",
          error_message: "Exceeded max retries (zombie timeout recovery)",
          retry_count: retryCount,
        })
        .eq("id", row.id);
      continue;
    }

    const { data: claimed } = await supabase
      .from("events")
      .update({
        status: "processing",
        locked_until: lockedUntil,
        retry_count: retryCount,
        ...(wasZombie ? { error_message: `Recovered from zombie state (attempt ${retryCount + 1})` } : {}),
      })
      .eq("id", row.id)
      .or(`status.eq.pending,status.eq.processing,status.eq.failed`)
      .select("*")
      .maybeSingle();

    if (claimed) {
      results.push(claimed as AgentEvent);
    }
  }

  return results;
}

export async function isEventCancelled(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("events")
    .select("status")
    .eq("id", eventId)
    .single();
  return data?.status === "dead";
}

export async function renewEventLock(
  eventId: string,
  extendSeconds: number = LOCK_DURATION_SECONDS,
  supabase = getSupabase(),
): Promise<void> {
  if (!eventId) return;
  const lockedUntil = new Date(Date.now() + extendSeconds * 1000).toISOString();
  await supabase
    .from("events")
    .update({ locked_until: lockedUntil })
    .eq("id", eventId)
    .eq("status", "processing");
}

export async function markProcessed(eventId: string, supabase = getSupabase()) {
  await supabase
    .from("events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);
}

export async function markFailed(
  eventId: string,
  errorMessage: string,
  supabase = getSupabase(),
) {

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

export async function cancelStaleEvents(
  platformChatId: string,
  agentId: string,
  excludeEventId?: string,
  supabase = getSupabase(),
): Promise<number> {
  let query = supabase
    .from("events")
    .update(
      { status: "dead" as const, error_message: "Cancelled: new session started" },
      { count: "exact" },
    )
    .eq("platform_chat_id", platformChatId)
    .eq("agent_id", agentId)
    .or("status.eq.pending,status.eq.processing,status.eq.failed");

  if (excludeEventId) {
    query = query.neq("id", excludeEventId);
  }

  const { count } = await query;
  return count ?? 0;
}

function backoffMs(retryCount: number): number {
  const base = [10_000, 30_000, 120_000, 600_000, 1_800_000];
  return base[Math.min(retryCount - 1, base.length - 1)];
}
