import { tool } from "ai";
import { z } from "zod/v4";
import { createClient } from "@supabase/supabase-js";
import {
  scheduleCronJob,
  unscheduleCronJob,
  listCronJobs,
  executeSQL,
} from "@/lib/supabase/management";

function bigrams(text: string): Set<string> {
  const clean = text.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean[i] + clean[i + 1]);
  }
  return set;
}

function bigramSimilarity(a: string, b: string): number {
  const sa = bigrams(a);
  const sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let overlap = 0;
  for (const g of sa) {
    if (sb.has(g)) overlap++;
  }
  return overlap / Math.min(sa.size, sb.size);
}

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface ToolsOptions {
  agentId: string;
  namespace: string;
  channelId?: string;
}

export function createAgentTools({ agentId, namespace, channelId }: ToolsOptions) {
  const supabase = getSupabase();

  function buildSoulTools(cid: string) {
    return {
      user_soul_update: tool({
        description:
          "Update the HUMAN USER's identity profile. Use for: real name, nickname/preferred address, " +
          "personality traits, language preference, biographical info about the HUMAN. " +
          "This REPLACES the entire user soul — always provide the complete, latest version.",
        inputSchema: z.object({
          content: z
            .string()
            .describe(
              "Complete user identity document in natural language. " +
              "Example: 'Name: 刘德华. Preferred address: 老刘. Language: Chinese. Personality: humorous.'"
            ),
        }),
        execute: async ({ content }: { content: string }) => {
          const { error } = await supabase
            .from("channels")
            .update({ user_soul: content })
            .eq("id", cid);
          if (error) return { success: false, error: error.message };
          return { success: true, message: "User soul updated" };
        },
      }),

      ai_soul_update: tool({
        description:
          "Update YOUR OWN (the AI's) identity profile. Use when the user gives you a name, " +
          "persona, role, or character trait. This is shared across ALL users of this agent. " +
          "This REPLACES the entire AI soul — always provide the complete, latest version.",
        inputSchema: z.object({
          content: z
            .string()
            .describe(
              "Complete AI identity document in natural language. " +
              "Example: 'Name: 宋承宪. Role: personal assistant. Tone: warm and professional.'"
            ),
        }),
        execute: async ({ content }: { content: string }) => {
          const { error } = await supabase
            .from("agents")
            .update({ ai_soul: content })
            .eq("id", agentId);
          if (error) return { success: false, error: error.message };
          return { success: true, message: "AI soul updated" };
        },
      }),
    };
  }

  const baseTools = {
    memory_write: tool({
      description:
        "Save a fact, decision, or summary to long-term memory. " +
        "Use this for KNOWLEDGE — things the user told you, decisions made, conversation summaries. " +
        "Do NOT use this for identity info — use user_soul_update or ai_soul_update instead. " +
        "Auto-deduplicates similar entries in the same category.",
      inputSchema: z.object({
        category: z
          .enum(["fact", "preference", "decision", "summary", "other"])
          .describe("Category of the memory"),
        content: z
          .string()
          .describe("The memory content. Must be self-contained."),
      }),
      execute: async ({
        category,
        content,
      }: {
        category: string;
        content: string;
      }) => {
        const { data: existing } = await supabase
          .from("memories")
          .select("id, content")
          .eq("agent_id", agentId)
          .eq("namespace", namespace)
          .eq("category", category);

        let replaced = 0;
        if (existing && existing.length > 0) {
          const toDelete: string[] = [];
          for (const mem of existing) {
            if (bigramSimilarity(content, mem.content as string) >= 0.35) {
              toDelete.push(mem.id);
            }
          }
          if (toDelete.length > 0) {
            await supabase.from("memories").delete().in("id", toDelete);
            replaced = toDelete.length;
          }
        }

        const { error } = await supabase.from("memories").insert({
          agent_id: agentId,
          namespace,
          category,
          content,
        });
        if (error) return { success: false, error: error.message };

        const msg =
          replaced > 0
            ? `Memory saved (replaced ${replaced} older entries)`
            : "Memory saved";
        return { success: true, message: msg };
      },
    }),

    memory_search: tool({
      description:
        "Search long-term memories for relevant information. " +
        "Use this to recall facts, decisions, or summaries from past conversations.",
      inputSchema: z.object({
        query: z.string().describe("Search query to find relevant memories"),
      }),
      execute: async ({ query }: { query: string }) => {
        const { data, error } = await supabase
          .from("memories")
          .select("category, content, created_at")
          .eq("agent_id", agentId)
          .eq("namespace", namespace)
          .ilike("content", `%${query}%`)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) return { success: false, error: error.message };
        return { success: true, memories: data };
      },
    }),

    get_current_time: tool({
      description: "Get the current date and time in ISO format.",
      inputSchema: z.object({}),
      execute: async () => {
        return { time: new Date().toISOString() };
      },
    }),

    schedule_task: tool({
      description:
        "Schedule a recurring or one-time task via pg_cron. Supports two modes:\n" +
        "1. reminder — send a fixed text message at the scheduled time.\n" +
        "2. agent_invoke — run a full agentic loop with the given prompt at the scheduled time " +
        "(useful for tasks needing external data like weather, summaries, etc.).\n" +
        "Use standard cron syntax: minute hour day month weekday. Timezone is UTC.\n" +
        "Set once=true for one-shot tasks (e.g. 'remind me in 30 minutes').",
      inputSchema: z.object({
        job_name: z
          .string()
          .describe(
            "Unique job name, lowercase with hyphens. e.g. 'remind-nap-daily'"
          ),
        cron_expression: z
          .string()
          .describe(
            "Cron expression. e.g. '0 6 * * *' for daily 6:00 UTC. " +
            "Format: minute hour day month weekday"
          ),
        task_type: z
          .enum(["reminder", "agent_invoke"])
          .describe(
            "reminder = send fixed text; agent_invoke = run agentic loop with prompt"
          ),
        message: z
          .string()
          .optional()
          .describe("For reminder: the text message to send"),
        prompt: z
          .string()
          .optional()
          .describe(
            "For agent_invoke: the prompt to trigger the agent (e.g. 'check today weather and tell user')"
          ),
        once: z
          .boolean()
          .optional()
          .describe("If true, auto-unschedule after first execution"),
      }),
      execute: async ({
        job_name,
        cron_expression,
        task_type,
        message,
        prompt,
        once,
      }: {
        job_name: string;
        cron_expression: string;
        task_type: "reminder" | "agent_invoke";
        message?: string;
        prompt?: string;
        once?: boolean;
      }) => {
        if (task_type === "reminder" && !message) {
          return { success: false, error: "message is required for reminder tasks" };
        }
        if (task_type === "agent_invoke" && !prompt) {
          return { success: false, error: "prompt is required for agent_invoke tasks" };
        }

        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000");
        const cronSecret = process.env.CRON_SECRET || "opencrab-cron";

        const chatIdResult = await supabase
          .from("sessions")
          .select("chat_id")
          .eq("agent_id", agentId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        if (!chatIdResult.data?.chat_id) {
          return { success: false, error: "No active chat session found" };
        }

        const chatId = chatIdResult.data.chat_id;

        const bodyObj: Record<string, unknown> = {
          task_type,
          agent_id: agentId,
          chat_id: chatId,
          job_name,
        };
        if (task_type === "reminder") bodyObj.message = message;
        if (task_type === "agent_invoke") bodyObj.prompt = prompt;
        if (once) bodyObj.once = true;

        const bodyStr = JSON.stringify(bodyObj).replace(/'/g, "''");

        const command = `SELECT net.http_post(url := '${appUrl}/api/worker/cron', headers := '{"Content-Type":"application/json","x-cron-secret":"${cronSecret}"}'::jsonb, body := '${bodyStr}'::jsonb)`;

        const result = await scheduleCronJob(job_name, cron_expression, command);
        if (!result.success) {
          return { success: false, error: result.error };
        }

        const taskConfig: Record<string, unknown> = { job_name, chat_id: chatId };
        if (message) taskConfig.message = message;
        if (prompt) taskConfig.prompt = prompt;
        if (once) taskConfig.once = true;

        await supabase.from("cron_jobs").insert({
          agent_id: agentId,
          schedule: cron_expression,
          task_type,
          task_config: taskConfig,
        });

        const desc = task_type === "reminder" ? message : prompt;
        return {
          success: true,
          message: `Task "${job_name}" (${task_type}) scheduled: ${cron_expression}${once ? " [one-shot]" : ""}`,
          details: desc,
        };
      },
    }),

    list_scheduled_jobs: tool({
      description:
        "List all scheduled cron jobs (reminders, tasks, etc). " +
        "Use when the user asks 'what reminders do I have' or 'show my scheduled tasks'.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await listCronJobs();
        if (!result.success) return { success: false, error: result.error };
        return { success: true, jobs: result.data };
      },
    }),

    cancel_scheduled_job: tool({
      description:
        "Cancel/remove a scheduled cron job by its name. " +
        "Use when the user says 'cancel my X reminder' or 'stop the daily reminder'.",
      inputSchema: z.object({
        job_name: z.string().describe("The name of the cron job to cancel"),
      }),
      execute: async ({ job_name }: { job_name: string }) => {
        const result = await unscheduleCronJob(job_name);
        if (!result.success) return { success: false, error: result.error };

        await supabase
          .from("cron_jobs")
          .update({ enabled: false })
          .eq("agent_id", agentId)
          .eq("task_type", "reminder")
          .filter("task_config->>'job_name'", "eq", job_name);

        return { success: true, message: `Job "${job_name}" cancelled` };
      },
    }),

    run_sql: tool({
      description:
        "Execute a read-only SQL query against the Supabase database via Management API. " +
        "Use for diagnostic queries: checking pg_cron status, viewing table sizes, " +
        "checking extension status, etc. NEVER use for destructive operations.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "SQL query to execute. Should be SELECT only for safety."
          ),
      }),
      execute: async ({ query }: { query: string }) => {
        const upper = query.trim().toUpperCase();
        if (
          upper.startsWith("DROP") ||
          upper.startsWith("DELETE") ||
          upper.startsWith("TRUNCATE")
        ) {
          return { success: false, error: "Destructive queries are not allowed" };
        }
        const result = await executeSQL(query);
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: result.data };
      },
    }),
  };

  if (channelId) {
    return { ...baseTools, ...buildSoulTools(channelId) };
  }
  return baseTools;
}
