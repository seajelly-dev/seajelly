import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildScopedCronJobName,
  findOwnedScheduledJobByName,
  listScheduledJobsForScope,
} from "@/lib/agent/scheduled-jobs";
import type { CronJob } from "@/types/database";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job_1",
    agent_id: "agent_1",
    schedule: "0 6 * * *",
    task_type: "reminder",
    task_config: {
      job_name: "morning-meds",
      pg_cron_job_name: "sj-owned-morning-meds",
      chat_id: "chat_1",
      platform: "telegram",
      message: "Take meds",
    },
    enabled: true,
    last_run: null,
    created_at: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function createCronJobsSupabase(rows: CronJob[]) {
  const calls: Array<{ table: string; column: string; value: unknown }> = [];
  const supabase = {
    from(table: string) {
      if (table !== "cron_jobs") throw new Error(`unexpected table ${table}`);
      const filters: Array<{ column: string; value: unknown }> = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          calls.push({ table, column, value });
          filters.push({ column, value });
          return query;
        },
        order() {
          const data = rows.filter((row) =>
            filters.every(({ column, value }) => {
              if (column === "task_config->>chat_id") {
                return String(row.task_config.chat_id ?? "") === value;
              }
              if (column === "task_config->>platform") {
                return row.task_config.platform === value;
              }
              if (column === "task_config->>job_name") {
                return row.task_config.job_name === value;
              }
              return (row as unknown as Record<string, unknown>)[column] === value;
            }),
          );
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { supabase, calls };
}

test("listScheduledJobsForScope only returns enabled jobs for the current agent chat", async () => {
  const { supabase, calls } = createCronJobsSupabase([
    makeJob({ id: "owned" }),
    makeJob({
      id: "same_agent_other_chat",
      task_config: {
        job_name: "other-chat",
        chat_id: "chat_2",
        platform: "telegram",
        message: "Other chat secret",
      },
    }),
    makeJob({
      id: "other_agent",
      agent_id: "agent_2",
      task_config: {
        job_name: "other-agent",
        chat_id: "chat_1",
        platform: "telegram",
        message: "Other agent secret",
      },
    }),
    makeJob({ id: "disabled", enabled: false }),
  ]);

  const result = await listScheduledJobsForScope(supabase, {
    agentId: "agent_1",
    platformChatId: "chat_1",
    platform: "telegram",
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    result.jobs.map((job) => job.id),
    ["owned"],
  );
  assert.deepEqual(result.jobs[0]?.task_config, {
    job_name: "morning-meds",
    message: "Take meds",
  });
  assert.ok(calls.some((call) => call.column === "agent_id" && call.value === "agent_1"));
  assert.ok(calls.some((call) => call.column === "task_config->>chat_id" && call.value === "chat_1"));
  assert.ok(calls.some((call) => call.column === "task_config->>platform" && call.value === "telegram"));
});

test("findOwnedScheduledJobByName returns the scoped pg_cron name only for owned jobs", async () => {
  const { supabase } = createCronJobsSupabase([
    makeJob({ id: "owned" }),
    makeJob({
      id: "same_name_other_chat",
      task_config: {
        job_name: "system-keepalive",
        pg_cron_job_name: "system-keepalive",
        chat_id: "chat_2",
        platform: "telegram",
        message: "Server maintenance",
      },
    }),
  ]);

  const missing = await findOwnedScheduledJobByName(
    supabase,
    { agentId: "agent_1", platformChatId: "chat_1", platform: "telegram" },
    "system-keepalive",
  );
  assert.equal(missing.success, true);
  assert.equal(missing.job, null);

  const owned = await findOwnedScheduledJobByName(
    supabase,
    { agentId: "agent_1", platformChatId: "chat_1", platform: "telegram" },
    "morning-meds",
  );
  assert.equal(owned.success, true);
  assert.equal(owned.job?.pgCronJobName, "sj-owned-morning-meds");
});

test("buildScopedCronJobName avoids pg_cron name collisions across chats", () => {
  const first = buildScopedCronJobName(
    { agentId: "agent_1", platformChatId: "chat_1", platform: "telegram" },
    "daily-report",
  );
  const second = buildScopedCronJobName(
    { agentId: "agent_1", platformChatId: "chat_2", platform: "telegram" },
    "daily-report",
  );

  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9][a-z0-9_-]{0,63}$/);
  assert.match(second, /^[a-z0-9][a-z0-9_-]{0,63}$/);
});
