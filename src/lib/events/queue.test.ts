import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimPendingEvents } from "@/lib/events/queue";
import type { AgentEvent } from "@/types/database";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "event_1",
    source: "telegram",
    agent_id: "agent_1",
    platform_chat_id: "chat_1",
    dedup_key: null,
    payload: {},
    status: "pending",
    locked_until: null,
    retry_count: 0,
    max_retries: 5,
    error_message: null,
    trace_id: "trace_1",
    created_at: new Date().toISOString(),
    processed_at: null,
    ...overrides,
  };
}

function createEventsSupabase(initialEvents: AgentEvent[]) {
  const events = structuredClone(initialEvents);

  const supabase = {
    from(table: string) {
      if (table !== "events") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Array<{ column: keyof AgentEvent; value: unknown }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column: column as keyof AgentEvent, value });
              return query;
            },
            or() {
              return query;
            },
            order() {
              return query;
            },
            limit(limit: number) {
              const now = Date.now();
              const data = events
                .filter((event) => {
                  if (filters.some(({ column, value }) => event[column] !== value)) return false;
                  if (event.status === "pending") return true;
                  if (event.status === "processing" || event.status === "failed") {
                    return event.locked_until != null && new Date(event.locked_until).getTime() < now;
                  }
                  return false;
                })
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .slice(0, limit)
                .map((event) => structuredClone(event));
              return Promise.resolve({ data });
            },
            async single() {
              const event = events.find((candidate) =>
                filters.every(({ column, value }) => candidate[column] === value),
              );
              if (!event) return { data: null, error: { message: "not found" } };
              return { data: structuredClone(event), error: null };
            },
          };
          return query;
        },
        update(patch: Partial<AgentEvent>) {
          const filters: Array<{ column: keyof AgentEvent; value: unknown }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column: column as keyof AgentEvent, value });
              return query;
            },
            or() {
              return query;
            },
            select() {
              return {
                async maybeSingle() {
                  const index = events.findIndex((candidate) =>
                    filters.every(({ column, value }) => candidate[column] === value),
                  );
                  if (index === -1) {
                    return { data: null, error: null };
                  }
                  events[index] = {
                    ...events[index],
                    ...structuredClone(patch),
                  };
                  return { data: structuredClone(events[index]), error: null };
                },
              };
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    readEvents: () => structuredClone(events) as AgentEvent[],
  };
}

test("claimPendingEvents reclaims failed events whose backoff has elapsed", async () => {
  const past = new Date(Date.now() - 5_000).toISOString();
  const { supabase, readEvents } = createEventsSupabase([
    makeEvent({
      id: "event_failed_ready",
      status: "failed",
      retry_count: 1,
      locked_until: past,
    }),
  ]);

  const claimed = await claimPendingEvents(supabase);

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.id, "event_failed_ready");
  assert.equal(claimed[0]?.status, "processing");
  assert.equal(claimed[0]?.retry_count, 1);
  assert.equal(readEvents()[0]?.status, "processing");
});

test("claimPendingEvents skips failed events whose backoff has not elapsed", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const { supabase } = createEventsSupabase([
    makeEvent({
      id: "event_failed_waiting",
      status: "failed",
      retry_count: 1,
      locked_until: future,
    }),
  ]);

  const claimed = await claimPendingEvents(supabase);

  assert.deepEqual(claimed, []);
});
