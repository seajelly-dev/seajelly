import { tool } from "ai";
import { z } from "zod/v4";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import {
  scheduleCronJob,
  unscheduleCronJob,
  listCronJobs,
  executeSQL,
} from "@/lib/supabase/management";
import {
  getE2BApiKey,
  runPythonCode,
  runJavaScriptCode,
  saveHTMLPreview,
  startBuildVerify,
  checkBuildStatus,
} from "@/lib/e2b/sandbox";
import {
  getGitHubConfig,
  parseRepo,
} from "@/lib/github/config";
import {
  getFile as githubGetFile,
  listTree as githubListTree,
  createCommitAndPush,
} from "@/lib/github/api";
import {
  createGithubBuildJob,
  getGithubBuildJob,
  syncGithubBuildJobStatus,
  updateGithubBuildJob,
} from "@/lib/github/jobs";
import type { PlatformSender } from "@/lib/platform/types";
import { botT, getBotLocaleOrDefault } from "@/lib/i18n/bot";
import type { Locale } from "@/lib/i18n/types";
import { generateTTS, logTTSUsage, getVoiceSettings } from "@/lib/voice/tts-engine";
import { isTextTooLong } from "@/lib/voice/tts-config-data";
import { generateImage } from "@/lib/image-gen/engine";
import { searchKnowledgeForAgent } from "@/lib/knowledge/search";

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
  channelId?: string;
  isOwner?: boolean;
  sender: PlatformSender;
  platformChatId: string;
  platform: string;
  locale?: Locale;
  traceId?: string;
}

function computePushPayloadHash(params: {
  files: { path: string; content: string }[];
  delete_files?: string[];
  message: string;
  branch?: string;
}): string {
  const files = [...params.files].sort((a, b) => a.path.localeCompare(b.path));
  const deleteFiles = [...(params.delete_files ?? [])].sort();
  const payload = {
    branch: params.branch ?? "main",
    message: params.message,
    files,
    delete_files: deleteFiles,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function computeBuildFilesHash(params: {
  files: { path: string; content: string }[];
  delete_files?: string[];
}): string {
  const files = [...params.files].sort((a, b) => a.path.localeCompare(b.path));
  const deleteFiles = [...(params.delete_files ?? [])].sort();
  return createHash("sha256")
    .update(JSON.stringify({ files, delete_files: deleteFiles }))
    .digest("hex");
}

export function createAgentTools({ agentId, channelId, isOwner, sender, platformChatId, platform, traceId }: ToolsOptions) {
  const supabase = getSupabase();

  function githubPipelineGuardError(): string | null {
    const raw = process.env.GITHUB_PIPELINE_ALLOWLIST?.trim();
    if (!raw) return null;
    const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.includes(agentId)) return null;
    return "GitHub pipeline is in gray release for selected agents only.";
  }

  function redactAudit(value: unknown): unknown {
    const sensitive = /(token|secret|apikey|api_key|password|authorization|bearer)/i;
    if (Array.isArray(value)) return value.map((v) => redactAudit(v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = sensitive.test(k) ? "[REDACTED]" : redactAudit(v);
      }
      return out;
    }
    return value;
  }

  function truncateAudit(value: unknown, maxChars = 8 * 1024): unknown {
    try {
      const redacted = redactAudit(value);
      const text = JSON.stringify(redacted);
      if (text.length <= maxChars) return redacted;
      return {
        _truncated: true,
        _original_length: text.length,
        _preview: text.slice(0, maxChars),
      };
    } catch {
      return { _unserializable: true };
    }
  }

  async function writePipelineAudit(entry: {
    toolName: string;
    input?: unknown;
    output?: unknown;
    status: "success" | "failed";
    errorMessage?: string;
    latencyMs?: number;
  }): Promise<void> {
    try {
      await supabase.from("agent_step_logs").insert({
        trace_id: traceId ?? `manual-${Date.now()}`,
        event_id: null,
        agent_id: agentId,
        channel_id: channelId ?? null,
        session_id: null,
        step_no: null,
        phase: "tool",
        tool_name: entry.toolName,
        tool_input_json: truncateAudit(entry.input ?? {}),
        tool_output_json: truncateAudit(entry.output ?? {}),
        model_text: null,
        status: entry.status,
        error_message: entry.errorMessage ?? null,
        latency_ms: entry.latencyMs ?? null,
      });
    } catch {
      // non-blocking
    }
  }

  function getTaskJobName(taskConfig: unknown): string | null {
    if (!taskConfig || typeof taskConfig !== "object") return null;
    const raw = (taskConfig as Record<string, unknown>).job_name;
    return typeof raw === "string" ? raw : null;
  }

  async function disableLocalCronJobs(jobName: string): Promise<{ updated: number; error?: string }> {
    const { data: rows, error: listErr } = await supabase
      .from("cron_jobs")
      .select("id, task_config")
      .eq("agent_id", agentId)
      .eq("enabled", true);
    if (listErr) {
      return { updated: 0, error: listErr.message };
    }

    const ids = (rows ?? [])
      .filter((r) => getTaskJobName(r.task_config) === jobName)
      .map((r) => r.id as string);
    if (ids.length === 0) {
      return { updated: 0 };
    }

    const { error: updateErr } = await supabase
      .from("cron_jobs")
      .update({ enabled: false })
      .in("id", ids);
    if (updateErr) {
      return { updated: 0, error: updateErr.message };
    }
    return { updated: ids.length };
  }

  function buildSoulTools(cid: string, ownerFlag: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const soulTools: Record<string, any> = {
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
    };

    if (ownerFlag) {
      soulTools.ai_soul_update = tool({
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
      });
    }

    return soulTools;
  }

  const baseTools = {
    memory_write: tool({
      description:
        "Save a fact, decision, or summary to long-term memory. " +
        "Use this for KNOWLEDGE — things the user told you, decisions made, conversation summaries. " +
        "Do NOT use this for identity info — use user_soul_update or ai_soul_update instead. " +
        "Auto-deduplicates similar entries in the same category.\n\n" +
        "scope='channel' (default): private to this user only.\n" +
        "scope='global': shared across ALL users of this agent (use for agent-wide knowledge only).",
      inputSchema: z.object({
        category: z
          .enum(["fact", "preference", "decision", "summary", "other"])
          .describe("Category of the memory"),
        content: z
          .string()
          .describe("The memory content. Must be self-contained."),
        scope: z
          .enum(["channel", "global"])
          .optional()
          .describe("'channel' = user-private (default), 'global' = shared across all users"),
      }),
      execute: async ({
        category,
        content,
        scope: rawScope,
      }: {
        category: string;
        content: string;
        scope?: string;
      }) => {
        const scope = rawScope === "global" ? "global" : "channel";
        if (scope === "channel" && !channelId) {
          return { success: false, error: "No channel context — cannot write channel-scoped memory" };
        }

        const q = supabase
          .from("memories")
          .select("id, content")
          .eq("agent_id", agentId)
          .eq("category", category)
          .eq("scope", scope);
        if (scope === "channel") q.eq("channel_id", channelId!);
        else q.is("channel_id", null);

        const { data: existing } = await q;

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
          channel_id: scope === "channel" ? channelId! : null,
          scope,
          category,
          content,
        });
        if (error) return { success: false, error: error.message };

        const msg =
          replaced > 0
            ? `Memory saved [${scope}] (replaced ${replaced} older entries)`
            : `Memory saved [${scope}]`;
        return { success: true, message: msg };
      },
    }),

    memory_search: tool({
      description:
        "Search long-term memories for relevant information. " +
        "Use this to recall facts, decisions, or summaries from past conversations. " +
        "Searches both user-private memories and agent-wide global memories.",
      inputSchema: z.object({
        query: z.string().describe("Search query to find relevant memories"),
      }),
      execute: async ({ query }: { query: string }) => {
        const { data, error } = await supabase
          .from("memories")
          .select("category, content, scope, created_at")
          .eq("agent_id", agentId)
          .or(
            channelId
              ? `and(channel_id.eq.${channelId},scope.eq.channel),scope.eq.global`
              : `scope.eq.global`
          )
          .ilike("content", `%${query}%`)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) return { success: false, error: error.message };
        return { success: true, memories: data };
      },
    }),

    get_current_time: tool({
      description:
        "Get the current date and time. Returns UTC time and, if a timezone is provided, " +
        "the local time in that timezone. Always call this before creating scheduled tasks " +
        "so you can correctly convert the user's local time to a UTC cron expression.\n\n" +
        "IMPORTANT: Check the user's soul (injected in system prompt under '## About This User') " +
        "for a saved timezone FIRST. If no timezone is found there, ASK the user for their timezone, " +
        "then IMMEDIATELY save it via `user_soul_update` (NOT memory_write) so it persists across sessions. " +
        "Timezone belongs in user_soul because it's needed every time, not in memories which require search.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone string, e.g. 'Asia/Shanghai', 'America/New_York', 'Europe/London'. " +
            "Read from user_soul first. If not available, ask the user and save via user_soul_update."
          ),
      }),
      execute: async ({ timezone }: { timezone?: string }) => {
        const now = new Date();
        const result: Record<string, string> = {
          utc: now.toISOString(),
          utc_readable: now.toUTCString(),
        };
        if (timezone) {
          try {
            result.local = now.toLocaleString("zh-CN", { timeZone: timezone });
            result.timezone = timezone;
            const utcOffset = getUtcOffset(now, timezone);
            result.utc_offset = utcOffset;
          } catch {
            result.timezone_error = `Invalid timezone: ${timezone}`;
          }
        }
        return result;
      },
    }),

    schedule_task: tool({
      description:
        "Schedule a recurring or one-time task via pg_cron. Supports two modes:\n" +
        "1. reminder — send a fixed text message at the scheduled time.\n" +
        "2. agent_invoke — run a full agentic loop with the given prompt at the scheduled time " +
        "(useful for tasks needing external data like weather, summaries, etc.).\n" +
        "Use standard cron syntax: minute hour day month weekday. Timezone is UTC.\n" +
        "Set once=true for one-shot tasks (e.g. 'remind me in 30 minutes').\n\n" +
        "IMPORTANT: Do NOT re-create tasks that were already scheduled in earlier messages. " +
        "Only create NEW tasks explicitly requested in the CURRENT user message. " +
        "Check conversation history — if a task was already confirmed as scheduled, do not schedule it again.",
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

        const { data: existingJobs } = await supabase
          .from("cron_jobs")
          .select("id, task_config")
          .eq("agent_id", agentId)
          .eq("schedule", cron_expression)
          .eq("task_type", task_type)
          .eq("enabled", true);

        if (existingJobs && existingJobs.length > 0) {
          const content = task_type === "reminder" ? message : prompt;
          const duplicate = existingJobs.find((j) => {
            const cfg = j.task_config as Record<string, unknown>;
            const existing = (cfg?.message ?? cfg?.prompt ?? "") as string;
            return existing === content;
          });
          if (duplicate) {
            return {
              success: false,
              error: `A ${task_type} task with the same schedule and content already exists. No duplicate created.`,
            };
          }
        }

        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000");
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
          return { success: false, error: "CRON_SECRET not configured — cannot schedule tasks" };
        }

        const chatId = platformChatId;

        const bodyObj: Record<string, unknown> = {
          task_type,
          agent_id: agentId,
          chat_id: chatId,
          platform,
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

        const taskConfig: Record<string, unknown> = { job_name, chat_id: chatId, platform };
        if (message) taskConfig.message = message;
        if (prompt) taskConfig.prompt = prompt;
        if (once) taskConfig.once = true;

        const { error: insertErr } = await supabase.from("cron_jobs").insert({
          agent_id: agentId,
          schedule: cron_expression,
          task_type,
          task_config: taskConfig,
        });
        if (insertErr) {
          // Avoid "pg_cron exists but local row missing" drift.
          try {
            await unscheduleCronJob(job_name);
          } catch {
            // best effort
          }
          return { success: false, error: `Failed to save local task record: ${insertErr.message}` };
        }

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
        const warnings: string[] = [];
        let pgSucceeded = true;

        try {
          const pgResult = await unscheduleCronJob(job_name);
          if (!pgResult.success) {
            pgSucceeded = false;
            warnings.push(`pg_cron: ${pgResult.error}`);
          }
        } catch (e) {
          pgSucceeded = false;
          warnings.push(`pg_cron: ${e instanceof Error ? e.message : "unknown error"}`);
        }

        const local = await disableLocalCronJobs(job_name);
        if (local.error) warnings.push(`db: ${local.error}`);
        const dbUpdated = local.updated > 0;

        if (!pgSucceeded && !dbUpdated) {
          return { success: false, error: `Job "${job_name}" not found or already cancelled` };
        }

        return {
          success: true,
          message: `Job "${job_name}" cancelled`,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      },
    }),

    get_weather: tool({
      description:
        "Get current weather and today's forecast for a given city or location. " +
        "Returns temperature, humidity, wind speed, weather condition, and daily high/low. " +
        "Use when the user asks about weather, what to wear, or whether to bring an umbrella. " +
        "City names can be in any language (e.g. '北京', 'Tokyo', 'New York').",
      inputSchema: z.object({
        city: z.string().describe("City name, e.g. '上海', 'London', 'San Francisco'"),
      }),
      execute: async ({ city }: { city: string }) => {
        try {
          const geoRes = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`
          );
          const geoData = await geoRes.json();
          if (!geoData.results?.length) {
            return { success: false, error: `City "${city}" not found` };
          }

          const { latitude, longitude, name, country } = geoData.results[0];

          const weatherRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
            `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
            `&timezone=auto&forecast_days=1`
          );
          const weather = await weatherRes.json();

          const WMO_CODES: Record<number, string> = {
            0: "晴天", 1: "大部晴朗", 2: "多云", 3: "阴天",
            45: "雾", 48: "雾凇", 51: "小毛毛雨", 53: "毛毛雨",
            55: "大毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
            71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
            80: "小阵雨", 81: "中阵雨", 82: "大阵雨",
            85: "小阵雪", 86: "大阵雪",
            95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹",
          };

          const current = weather.current;
          const daily = weather.daily;

          return {
            success: true,
            location: `${name}, ${country}`,
            current: {
              temperature: `${current.temperature_2m}°C`,
              feels_like: `${current.apparent_temperature}°C`,
              humidity: `${current.relative_humidity_2m}%`,
              wind_speed: `${current.wind_speed_10m} km/h`,
              condition: WMO_CODES[current.weather_code] || `code ${current.weather_code}`,
            },
            today: {
              high: `${daily.temperature_2m_max[0]}°C`,
              low: `${daily.temperature_2m_min[0]}°C`,
              condition: WMO_CODES[daily.weather_code[0]] || `code ${daily.weather_code[0]}`,
              rain_probability: `${daily.precipitation_probability_max[0]}%`,
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Weather fetch failed" };
        }
      },
    }),

    knowledge_search: tool({
      description:
        "Search the agent's mounted knowledge bases using semantic vector search. " +
        "Retrieves the most relevant chunks, then fetches the full source articles as context. " +
        "Use this when the user asks questions that may be answered by the knowledge base " +
        "(e.g. policies, rules, documentation, FAQs). " +
        "You MUST base your answer on the returned article content — do not fabricate information.",
      inputSchema: z.object({
        query: z.string().describe("The search query in natural language"),
        top_k: z
          .number()
          .optional()
          .describe("Number of chunk results for retrieval (default: 10, max: 20)"),
      }),
      execute: async ({ query, top_k }: { query: string; top_k?: number }) => {
        const k = Math.min(top_k ?? 10, 20);
        const result = await searchKnowledgeForAgent(agentId, query, k);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return {
          success: true,
          matched_chunks: result.chunks.length,
          source_articles: result.articles.length,
          articles: result.articles.map((a) => ({
            title: a.title,
            knowledge_base: a.knowledge_base_name,
            relevance: Math.round(a.max_similarity * 1000) / 1000,
            matched_chunks: a.matched_chunks,
            content: a.content,
          })),
        };
      },
    }),

    run_sql: tool({
      description:
        "Execute a read-only SELECT query against the Supabase database via Management API. " +
        "Use for diagnostic queries: checking pg_cron status, viewing table sizes, " +
        "checking extension status, etc. Only SELECT statements are allowed. " +
        "Queries are restricted to safe system catalog tables and public schema tables.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "SQL SELECT query to execute. Only single SELECT statements are allowed."
          ),
      }),
      execute: async ({ query }: { query: string }) => {
        const normalized = query
          .replace(/--.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim();
        if (!/^SELECT\b/i.test(normalized)) {
          return { success: false, error: "Only SELECT queries are allowed" };
        }
        if (normalized.replace(/;$/, "").includes(";")) {
          return { success: false, error: "Multiple statements not allowed" };
        }
        if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i.test(normalized)) {
          return { success: false, error: "Write operations not allowed" };
        }
        const BLOCKED_TABLES = [
          /\bauth\./i,
          /\bsecrets\b/i,
          /\bcron\.job\b/i,
          /\bcron\.job_run_details\b/i,
          /\bpg_shadow\b/i,
          /\bpg_authid\b/i,
        ];
        for (const pattern of BLOCKED_TABLES) {
          if (pattern.test(normalized)) {
            return { success: false, error: `Access to ${pattern.source} is not allowed` };
          }
        }
        const result = await executeSQL(query);
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: result.data };
      },
    }),

    run_python_code: tool({
      description:
        "Execute Python code in a secure E2B cloud sandbox and return real results. " +
        "YOU MUST CALL THIS TOOL whenever the user wants to: run Python, generate charts/plots, " +
        "do data analysis, create visualizations, or anything requiring Python execution. " +
        "Returns stdout, stderr, and generated charts/images as base64 PNG. " +
        "The sandbox has internet access and common libraries pre-installed " +
        "(numpy, pandas, matplotlib, seaborn, scipy, scikit-learn, etc). " +
        "Each execution creates a fresh sandbox (stateless). " +
        "IMPORTANT: Never just output Python code as text — always call this tool to actually execute it.",
      inputSchema: z.object({
        code: z.string().describe("Python code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        const apiKey = await getE2BApiKey();
        if (!apiKey) {
          return { success: false, error: "E2B_API_KEY not configured. Ask the admin to add it in Dashboard > Secrets." };
        }
        try {
          const result = await runPythonCode(apiKey, code);
          return {
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
            results: result.results,
            executionTimeMs: result.executionTimeMs,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Execution failed" };
        }
      },
    }),

    run_javascript_code: tool({
      description:
        "Execute JavaScript/TypeScript code in a secure E2B cloud sandbox and return real results. " +
        "YOU MUST CALL THIS TOOL whenever the user wants to run JavaScript or Node.js code. " +
        "Returns stdout and stderr. Supports top-level await, ESM imports, and Node.js APIs. " +
        "Each execution creates a fresh sandbox. " +
        "IMPORTANT: Never just output JS code as text — always call this tool to actually execute it.",
      inputSchema: z.object({
        code: z.string().describe("JavaScript or TypeScript code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        const apiKey = await getE2BApiKey();
        if (!apiKey) {
          return { success: false, error: "E2B_API_KEY not configured. Ask the admin to add it in Dashboard > Secrets." };
        }
        try {
          const result = await runJavaScriptCode(apiKey, code);
          return {
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
            results: result.results,
            executionTimeMs: result.executionTimeMs,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Execution failed" };
        }
      },
    }),

    run_html_preview: tool({
      description:
        "Create an HTML page and return a permanent public preview URL. " +
        "YOU MUST CALL THIS TOOL whenever the user wants to create HTML pages, landing pages, " +
        "web UI demos, or any visual web content. The preview link never expires and does not " +
        "require login. No E2B sandbox or credits consumed. " +
        "Include all CSS and JS inline. " +
        "IMPORTANT: Never output raw HTML as text — always call this tool to generate a clickable URL.",
      inputSchema: z.object({
        html: z.string().describe("Complete HTML document to preview"),
        title: z.string().optional().describe("Title for the preview page"),
      }),
      execute: async ({ html, title }: { html: string; title?: string }) => {
        try {
          const result = await saveHTMLPreview(html, title);
          return {
            success: true,
            previewUrl: result.previewUrl,
            message: `Preview ready: ${result.previewUrl}`,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Preview failed" };
        }
      },
    }),

    github_read_file: tool({
      description:
        "Read a file from the project's GitHub repository. " +
        "Returns the file content as a string. Use this to understand existing code before making changes. " +
        "Requires GITHUB_TOKEN and GITHUB_REPO to be configured.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repo root, e.g. 'src/app/page.tsx'"),
        branch: z.string().optional().describe("Branch name, defaults to main"),
      }),
      execute: async ({ path, branch }: { path: string; branch?: string }) => {
        const { token, repo } = await getGitHubConfig();
        if (!token || !repo) {
          return { success: false, error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
        }
        try {
          const { owner, name } = parseRepo(repo);
          const result = await githubGetFile(token, `${owner}/${name}`, path, branch);
          return { success: true, content: result.content, sha: result.sha };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Read failed" };
        }
      },
    }),

    github_list_files: tool({
      description:
        "List ALL files in the project's GitHub repository as a flat recursive tree. " +
        "Returns the COMPLETE file list in one call (excludes node_modules, .git, dist, lock files). " +
        "IMPORTANT: Call this ONCE with empty path to get the full project structure. " +
        "Do NOT call repeatedly for individual subdirectories — one call is enough.",
      inputSchema: z.object({
        path: z.string().optional().describe("Optional directory prefix filter. Leave empty to get the FULL repo tree (recommended)"),
        branch: z.string().optional().describe("Branch name, defaults to main"),
      }),
      execute: async ({ path, branch }: { path?: string; branch?: string }) => {
        const { token, repo } = await getGitHubConfig();
        if (!token || !repo) {
          return { success: false, error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
        }
        try {
          const { owner, name } = parseRepo(repo);
          const files = await githubListTree(token, `${owner}/${name}`, path, branch);
          return { success: true, files, count: files.length, hint: "This is the full recursive file list. No need to list subdirectories separately." };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "List failed" };
        }
      },
    }),

    github_build_verify: tool({
      description:
        "Clone the project repo into an E2B sandbox, apply code changes, and run a build to verify. " +
        "IMPORTANT: Call this tool ONLY ONCE per task. Do NOT call it multiple times for the same change. " +
        "This is an ASYNC operation — it immediately returns a persistent job_id. " +
        "After calling this, call github_build_status 2-3 times max. If still building, " +
        "STOP and tell the user to check back later. " +
        "SKIP this tool entirely if changes are non-code files only (e.g. .txt, .md, images) — go directly to github_request_push_approval. " +
        "BUILD ENVIRONMENT: The E2B sandbox has node/npm (NOT pnpm/yarn). " +
        "Use `npm install` for install and `npm run build` for build. Do NOT use pnpm or yarn. " +
        "Requires E2B_API_KEY, GITHUB_TOKEN, and GITHUB_REPO to be configured.",
      inputSchema: z.object({
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .describe("Files to create or modify, with paths relative to repo root"),
        delete_files: z
          .array(z.string())
          .optional()
          .describe("Files to delete, paths relative to repo root"),
        install_cmd: z.string().optional().describe("Install command. Default: npm install. MUST use npm, NOT pnpm/yarn."),
        build_cmd: z.string().optional().describe("Build command. Default: npm run build. MUST use npm, NOT pnpm/yarn."),
        serve_cmd: z.string().optional().describe("Serve command for previewing build output. E.g. npx serve out -l 3000"),
        port: z.number().optional().describe("Port for the preview server, default: 3000"),
        ttl_minutes: z.number().optional().describe("Job TTL in minutes, default: 60, max: 180"),
      }),
      execute: async (params: {
        files: { path: string; content: string }[];
        delete_files?: string[];
        install_cmd?: string;
        build_cmd?: string;
        serve_cmd?: string;
        port?: number;
        ttl_minutes?: number;
      }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          await writePipelineAudit({
            toolName: "github_build_verify",
            input: params,
            output: { blocked: true },
            status: "failed",
            errorMessage: guardErr,
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: guardErr };
        }

        const apiKey = await getE2BApiKey();
        if (!apiKey) {
          return { success: false, error: "E2B_API_KEY not configured." };
        }
        const { token, repo } = await getGitHubConfig();
        if (!token || !repo) {
          return { success: false, error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
        }
        const expiresMinutes = Math.max(10, Math.min(180, Math.floor(params.ttl_minutes ?? 60)));
        const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();
        const filesHash = computeBuildFilesHash({
          files: params.files,
          delete_files: params.delete_files,
        });

        let requesterUid: string | null = null;
        if (channelId) {
          const { data: ch } = await supabase
            .from("channels")
            .select("platform_uid")
            .eq("id", channelId)
            .single();
          requesterUid = (ch?.platform_uid as string | undefined) ?? null;
        }

        const job = await createGithubBuildJob({
          agentId,
          channelId: channelId ?? null,
          requesterUid,
          traceId: traceId ?? null,
          filesHash,
          port: params.port ?? 3000,
          expiresAt,
          metadata: {
            install_cmd: params.install_cmd ?? null,
            build_cmd: params.build_cmd ?? null,
            serve_cmd: params.serve_cmd ?? null,
            file_count: params.files.length,
            delete_count: params.delete_files?.length ?? 0,
          },
        });

        try {
          const { owner, name } = parseRepo(repo);
          const result = await startBuildVerify({
            apiKey,
            repoUrl: `https://github.com/${owner}/${name}.git`,
            githubToken: token,
            files: params.files,
            deleteFiles: params.delete_files,
            installCmd: params.install_cmd,
            buildCmd: params.build_cmd,
            serveCmd: params.serve_cmd,
            port: params.port,
          });
          await updateGithubBuildJob(job.id, {
            status: "building",
            phase: "clone",
            sandbox_id: result.sandboxId,
            started_at: new Date().toISOString(),
            last_log: "Build started in E2B sandbox",
          });
          await writePipelineAudit({
            toolName: "github_build_verify",
            input: {
              job_id: job.id,
              files_count: params.files.length,
              delete_count: params.delete_files?.length ?? 0,
            },
            output: {
              jobId: job.id,
              sandboxId: result.sandboxId,
              status: "building",
            },
            status: "success",
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: true,
            jobId: job.id,
            sandboxId: result.sandboxId,
            status: "building",
            expiresAt,
            message: "Build started. Use github_build_status with job_id to check progress.",
          };
        } catch (err) {
          await updateGithubBuildJob(job.id, {
            status: "failed",
            phase: "queued",
            error_code: "build_start_failed",
            finished_at: new Date().toISOString(),
            last_log: err instanceof Error ? err.message : "Build start failed",
          }).catch(() => {});
          await writePipelineAudit({
            toolName: "github_build_verify",
            input: {
              job_id: job.id,
              files_count: params.files.length,
              delete_count: params.delete_files?.length ?? 0,
            },
            output: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Build start failed",
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: err instanceof Error ? err.message : "Build start failed" };
        }
      },
    }),

    github_build_status: tool({
      description:
        "Check the status of an async build verification started by github_build_verify. " +
        "Use job_id as the primary identifier. It returns pending/building/success/failed/expired and build metadata. " +
        "Poll this every ~15 seconds after starting a build.",
      inputSchema: z
        .object({
          job_id: z.string().optional().describe("Job ID returned by github_build_verify (preferred)"),
          sandbox_id: z.string().optional().describe("Legacy fallback sandbox ID"),
          port: z.number().optional().describe("Port the preview server uses, default: 3000"),
        })
        .refine((v) => Boolean(v.job_id || v.sandbox_id), "job_id or sandbox_id is required"),
      execute: async ({ job_id, sandbox_id, port }: { job_id?: string; sandbox_id?: string; port?: number }) => {
        try {
          let jobId = job_id ?? null;
          if (!jobId && sandbox_id) {
            const { data: row } = await supabase
              .from("github_build_jobs")
              .select("id")
              .eq("sandbox_id", sandbox_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            jobId = (row?.id as string | undefined) ?? null;
          }

          if (jobId) {
            let job = await getGithubBuildJob(jobId);
            if (!job) return { success: false, error: "Build job not found." };
            if (job.status === "pending" || job.status === "building") {
              job = (await syncGithubBuildJobStatus(job.id)) ?? job;
            }
            return {
              success: true,
              jobId: job.id,
              sandboxId: job.sandbox_id,
              status: job.status,
              phase: job.phase,
              log: job.last_log,
              previewUrl: job.preview_url,
              errorCode: job.error_code,
              startedAt: job.started_at,
              finishedAt: job.finished_at,
              expiresAt: job.expires_at,
            };
          }

          // Backward compatibility path when only sandbox_id is available.
          if (!sandbox_id) return { success: false, error: "job_id or sandbox_id is required." };
          const apiKey = await getE2BApiKey();
          if (!apiKey) {
            return { success: false, error: "E2B_API_KEY not configured." };
          }
          const status = await checkBuildStatus(apiKey, sandbox_id, port);
          return { success: true, sandboxId: sandbox_id, ...status };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Status check failed" };
        }
      },
    }),

    github_request_push_approval: tool({
      description:
        "Request an explicit, one-time owner approval to commit and push code changes to GitHub. " +
        "This sends an Approve/Reject button to the owner and returns an approval_id. " +
        "IMPORTANT: After calling this, do NOT poll github_push_approval_status in the same turn. " +
        "Instead, immediately reply to the user that the approval request has been sent and wait for their next message. " +
        "The user will tell you to proceed after they approve.",
      inputSchema: z.object({
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .describe("Files that would be committed, with paths relative to repo root"),
        delete_files: z
          .array(z.string())
          .optional()
          .describe("Files to delete in this commit"),
        message: z.string().describe("Git commit message"),
        branch: z.string().optional().describe("Target branch, default: main"),
        build_job_id: z.string().describe("A github_build_verify job_id that has status=success"),
        expires_in_minutes: z
          .number()
          .optional()
          .describe("Approval expiry window in minutes (default: 10, max: 60)"),
      }),
      execute: async (params: {
        files: { path: string; content: string }[];
        delete_files?: string[];
        message: string;
        branch?: string;
        build_job_id: string;
        expires_in_minutes?: number;
      }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          await writePipelineAudit({
            toolName: "github_request_push_approval",
            input: params,
            output: { blocked: true },
            status: "failed",
            errorMessage: guardErr,
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: guardErr };
        }

        if (!channelId) {
          return { success: false, error: "No channel context for push approval request." };
        }

        const [{ data: requestCh }, { data: ownerCh }] = await Promise.all([
          supabase
            .from("channels")
            .select("id, platform_uid, display_name")
            .eq("id", channelId)
            .single(),
          supabase
            .from("channels")
            .select("id, platform_uid")
            .eq("agent_id", agentId)
            .eq("is_owner", true)
            .single(),
        ]);

        if (!requestCh) return { success: false, error: "Request channel not found." };
        if (!ownerCh?.platform_uid) return { success: false, error: "Owner channel not found." };

        const branch = params.branch ?? "main";
        const expiresMinutes = Math.max(1, Math.min(60, Math.floor(params.expires_in_minutes ?? 10)));
        const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();

        const buildJob = await getGithubBuildJob(params.build_job_id);
        if (!buildJob) return { success: false, error: "Build job not found." };
        if (buildJob.status !== "success") {
          return { success: false, error: `Build job not successful (status: ${buildJob.status}).` };
        }
        if (buildJob.expires_at && Date.now() > Date.parse(buildJob.expires_at)) {
          return { success: false, error: "Build job expired." };
        }

        const filePaths = params.files.map((f) => f.path).sort();
        const deletePaths = [...(params.delete_files ?? [])].sort();
        const payloadHash = computePushPayloadHash(params);
        const filesHash = computeBuildFilesHash({ files: params.files, delete_files: params.delete_files });
        if (buildJob.files_hash !== filesHash) {
          return { success: false, error: "Build job does not match current file payload." };
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("github_push_approvals")
          .insert({
            agent_id: agentId,
            request_channel_id: requestCh.id,
            requested_by_uid: requestCh.platform_uid,
            status: "pending",
            payload_hash: payloadHash,
            branch,
            commit_message: params.message,
            files: filePaths,
            delete_files: deletePaths,
            build_job_id: buildJob.id,
            expires_at: expiresAt,
          })
          .select("id")
          .single();

        if (insertErr || !inserted?.id) {
          return { success: false, error: insertErr?.message || "Failed to create approval request." };
        }

        const requesterName = requestCh.display_name || requestCh.platform_uid;
        const filesPreview = filePaths.slice(0, 15).map((p) => `- \`${p}\``).join("\n");
        const deletesPreview = deletePaths.slice(0, 15).map((p) => `- \`${p}\``).join("\n");
        const moreFiles = filePaths.length > 15 ? `\n… and ${filePaths.length - 15} more` : "";
        const moreDeletes = deletePaths.length > 15 ? `\n… and ${deletePaths.length - 15} more` : "";

        const text =
          `🚀 *Push Approval Required*\n\n` +
          `*Requested by:* ${requesterName}\n` +
          `*Branch:* \`${branch}\`\n` +
          `*Build Job:* \`${buildJob.id}\`\n` +
          `*Commit message:* ${params.message}\n\n` +
          (filePaths.length ? `*Files:*\n${filesPreview}${moreFiles}\n\n` : "") +
          (deletePaths.length ? `*Delete:*\n${deletesPreview}${moreDeletes}\n\n` : "") +
          `*Approval ID:* \`${inserted.id}\`\n` +
          `*Expires in:* ${expiresMinutes} min`;

        try {
          await sender.sendInteractiveButtons(
            ownerCh.platform_uid,
            text,
            [[
              { label: "✅ Approve Push", callbackData: `push_approve:${inserted.id}` },
              { label: "❌ Reject", callbackData: `push_reject:${inserted.id}` },
            ]],
            { parseMode: "Markdown" },
          );
        } catch (err) {
          await writePipelineAudit({
            toolName: "github_request_push_approval",
            input: {
              build_job_id: buildJob.id,
              branch,
              files_count: filePaths.length,
              delete_count: deletePaths.length,
            },
            output: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Failed to send approval request.",
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: err instanceof Error ? err.message : "Failed to send approval request." };
        }

        await writePipelineAudit({
          toolName: "github_request_push_approval",
          input: {
            build_job_id: buildJob.id,
            branch,
            files_count: filePaths.length,
            delete_count: deletePaths.length,
          },
          output: {
            approval_id: inserted.id,
            expires_at: expiresAt,
          },
          status: "success",
          latencyMs: Date.now() - startedAtMs,
        });

        return {
          success: true,
          approvalId: inserted.id,
          buildJobId: buildJob.id,
          expiresAt,
          message: "Approval requested from owner. Use github_push_approval_status to check status.",
        };
      },
    }),

    github_push_approval_status: tool({
      description:
        "Check the status of a push approval requested by github_request_push_approval. " +
        "Returns pending/approved/rejected/expired/used.",
      inputSchema: z.object({
        approval_id: z.string().describe("Approval ID returned by github_request_push_approval"),
      }),
      execute: async ({ approval_id }: { approval_id: string }) => {
        const { data: row, error } = await supabase
          .from("github_push_approvals")
          .select("id, status, build_job_id, expires_at, approved_at, rejected_at, used_at")
          .eq("id", approval_id)
          .single();

        if (error || !row) {
          return { success: false, error: error?.message || "Approval not found." };
        }

        const expiresAtMs = new Date(row.expires_at as string).getTime();
        if (row.status === "pending" && Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          await supabase
            .from("github_push_approvals")
            .update({ status: "expired" })
            .eq("id", approval_id);
          return { success: true, status: "expired", expiresAt: row.expires_at };
        }

        return {
          success: true,
          status: row.status,
          buildJobId: row.build_job_id,
          expiresAt: row.expires_at,
          approvedAt: row.approved_at,
          rejectedAt: row.rejected_at,
          usedAt: row.used_at,
        };
      },
    }),

    github_commit_push: tool({
      description:
        "Commit and push code changes to the project's GitHub repository. " +
        "CRITICAL: This requires an explicit one-time owner approval via github_request_push_approval. " +
        "Never push without approval. This triggers Vercel auto-deployment. " +
        "Use github_build_verify first to validate changes.",
      inputSchema: z.object({
        approval_id: z.string().describe("Approval ID from github_request_push_approval (must be approved)"),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .describe("Files to commit, with paths relative to repo root"),
        delete_files: z
          .array(z.string())
          .optional()
          .describe("Files to delete in this commit"),
        message: z.string().describe("Git commit message"),
        branch: z.string().optional().describe("Target branch, default: main"),
      }),
      execute: async (params: {
        files: { path: string; content: string }[];
        delete_files?: string[];
        message: string;
        branch?: string;
        approval_id: string;
      }) => {
        const startedAtMs = Date.now();
        const guardErr = githubPipelineGuardError();
        if (guardErr) {
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: params,
            output: { blocked: true },
            status: "failed",
            errorMessage: guardErr,
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: guardErr };
        }

        if (!channelId) {
          return { success: false, error: "No channel context for push." };
        }

        const { data: callerCh } = await supabase
          .from("channels")
          .select("id, is_owner")
          .eq("id", channelId)
          .single();
        if (!callerCh?.is_owner) {
          return { success: false, error: "Only the owner channel can push to GitHub." };
        }

        const { data: approval, error: approvalErr } = await supabase
          .from("github_push_approvals")
          .select("id, status, payload_hash, branch, commit_message, build_job_id, expires_at, used_at")
          .eq("id", params.approval_id)
          .single();
        if (approvalErr || !approval) {
          return { success: false, error: approvalErr?.message || "Approval not found." };
        }

        const expiresAtMs = new Date(approval.expires_at as string).getTime();
        if (approval.status === "pending" && Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          await supabase
            .from("github_push_approvals")
            .update({ status: "expired" })
            .eq("id", params.approval_id);
          return { success: false, error: "Approval expired." };
        }

        if (approval.status !== "approved") {
          return { success: false, error: `Approval not granted (status: ${approval.status}).` };
        }
        if (approval.used_at) {
          return { success: false, error: "Approval already used." };
        }

        const branch = params.branch ?? "main";
        if (approval.branch !== branch || approval.commit_message !== params.message) {
          return { success: false, error: "Approval does not match branch or commit message." };
        }

        const payloadHash = computePushPayloadHash(params);
        if (payloadHash !== approval.payload_hash) {
          return { success: false, error: "Approval does not match the proposed file changes." };
        }

        if (!approval.build_job_id) {
          return { success: false, error: "Approval is not bound to a build job." };
        }
        const buildJob = await getGithubBuildJob(approval.build_job_id as string);
        if (!buildJob) {
          return { success: false, error: "Bound build job not found." };
        }
        if (buildJob.status !== "success") {
          return { success: false, error: `Bound build job not successful (status: ${buildJob.status}).` };
        }
        if (buildJob.expires_at && Date.now() > Date.parse(buildJob.expires_at)) {
          return { success: false, error: "Bound build job expired." };
        }
        const filesHash = computeBuildFilesHash({
          files: params.files,
          delete_files: params.delete_files,
        });
        if (buildJob.files_hash !== filesHash) {
          return { success: false, error: "Bound build job does not match file payload hash." };
        }

        const { token, repo } = await getGitHubConfig();
        if (!token || !repo) {
          return { success: false, error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
        }
        try {
          const { owner, name } = parseRepo(repo);
          const result = await createCommitAndPush(
            token,
            `${owner}/${name}`,
            params.files,
            params.delete_files ?? [],
            params.message,
            branch
          );
          await updateGithubBuildJob(buildJob.id, {
            metadata: {
              ...(buildJob.metadata ?? {}),
              pushed_commit_sha: result.commitSha,
              pushed_at: new Date().toISOString(),
              approval_id: params.approval_id,
              branch,
            },
          }).catch(() => {});
          await supabase
            .from("github_push_approvals")
            .update({ status: "used", used_at: new Date().toISOString() })
            .eq("id", params.approval_id);
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: {
              approval_id: params.approval_id,
              build_job_id: buildJob.id,
              branch,
              files_count: params.files.length,
              delete_count: params.delete_files?.length ?? 0,
            },
            output: {
              commit_sha: result.commitSha,
              commit_url: result.commitUrl,
            },
            status: "success",
            latencyMs: Date.now() - startedAtMs,
          });
          return {
            success: true,
            commitSha: result.commitSha,
            commitUrl: result.commitUrl,
            message: `Committed and pushed: ${result.commitUrl}`,
          };
        } catch (err) {
          await writePipelineAudit({
            toolName: "github_commit_push",
            input: {
              approval_id: params.approval_id,
              branch: params.branch ?? "main",
              files_count: params.files.length,
              delete_count: params.delete_files?.length ?? 0,
            },
            output: null,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Push failed",
            latencyMs: Date.now() - startedAtMs,
          });
          return { success: false, error: err instanceof Error ? err.message : "Push failed" };
        }
      },
    }),
  };

  const ttsTools = {
    tts_speak: tool({
      description:
        "Convert text to speech audio and send it as a voice message in the current chat. " +
        "Use this when the user asks you to read something aloud or send a voice message. " +
        "Text must be under 250 CJK characters or 500 Latin characters.",
      inputSchema: z.object({
        text: z.string().describe("The text to convert to speech"),
        voice: z.string().optional().describe("Voice name (e.g. Aoede, Puck, Kore). Optional."),
      }),
      execute: async ({ text, voice }: { text: string; voice?: string }) => {
        try {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("tools_config")
            .eq("id", agentId)
            .single();
          const tc = (agentRow?.tools_config ?? {}) as Record<string, boolean>;
          if (!tc.tts_speak) {
            return { success: false, error: "TTS is disabled for this agent. The owner can enable it with /tts command." };
          }
          const settings = await getVoiceSettings();
          if (isTextTooLong(text)) {
            return { success: false, error: "Text too long. Max 250 CJK characters or 500 Latin characters." };
          }
          const result = await generateTTS({ text, voice });
          const audioBuffer = Buffer.from(result.audioBase64, "base64");
          if (platformChatId) {
            if (sender.platform === "wecom") {
              await sender.sendText(platformChatId, `🔊 ${text}`);
            } else {
              await sender.sendVoice(platformChatId, audioBuffer, "voice.wav");
            }
          }
          await logTTSUsage({
            agentId,
            channelId,
            engine: settings.tts_engine || "aistudio",
            model: settings.tts_model,
            voice: voice || settings.tts_voice,
            inputText: text,
            durationMs: result.durationMs,
          });
          return { success: true, message: "Voice message sent" };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "TTS failed" };
        }
      },
    }),
  };

  const imageGenTools = {
    image_generate: tool({
      description:
        "Generate or edit an image and send it to the current chat. " +
        "Supports two modes:\n" +
        "1. Text-to-image: provide only `prompt` to generate a new image from scratch.\n" +
        "2. Image editing: provide `prompt` + `source_image_base64` to modify an existing image " +
        "(e.g. add/remove elements, change style, adjust colors).\n" +
        "Always provide a detailed, descriptive prompt in English for best results.",
      inputSchema: z.object({
        prompt: z.string().describe(
          "Detailed prompt describing the desired image (for generation) or the desired edit (for editing). " +
          "For editing, describe what to change, e.g. 'Change the sofa color to red' or 'Add a hat to the cat'."
        ),
        source_image_base64: z.string().optional().describe(
          "Base64-encoded source image for editing mode. Omit for text-to-image generation. " +
          "When the user sends an image and asks to modify it, extract the image data and pass it here."
        ),
        source_mime_type: z.string().optional().describe(
          "MIME type of the source image, e.g. 'image/png' or 'image/jpeg'. Defaults to 'image/png' if omitted."
        ),
      }),
      execute: async ({ prompt, source_image_base64, source_mime_type }: {
        prompt: string;
        source_image_base64?: string;
        source_mime_type?: string;
      }) => {
        try {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("tools_config")
            .eq("id", agentId)
            .single();
          const tc = (agentRow?.tools_config ?? {}) as Record<string, boolean>;
          if (!tc.image_generate) {
            return { success: false, error: "Image generation is disabled for this agent. The admin can enable it in Dashboard > Agents > Tool Settings." };
          }
          const result = await generateImage({
            prompt,
            sourceImageBase64: source_image_base64,
            sourceMimeType: source_mime_type,
          });
          const imageBuffer = Buffer.from(result.imageBase64, "base64");
          if (platformChatId) {
            await sender.sendPhoto(platformChatId, imageBuffer, result.textResponse || undefined);
          }
          const mode = source_image_base64 ? "edited" : "generated";
          return {
            success: true,
            message: `Image ${mode} and sent`,
            textResponse: result.textResponse || "",
            durationMs: result.durationMs,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Image generation failed" };
        }
      },
    }),
  };

  if (channelId) {
    return { ...baseTools, ...ttsTools, ...imageGenTools, ...buildSoulTools(channelId, !!isOwner) };
  }
  return { ...baseTools, ...ttsTools, ...imageGenTools };
}

export function createSubAppTools({ agentId, channelId, isOwner, sender, platformChatId, platform, locale }: ToolsOptions) {
  const supabase = getSupabase();
  const botLocale = getBotLocaleOrDefault(locale);
  const t = (k: Parameters<typeof botT>[1], p?: Parameters<typeof botT>[2]) => botT(botLocale, k, p);
  const sendToCurrent = async (message: string) => {
    if (!sender || !platformChatId) return;
    try {
      await sender.sendMarkdown(platformChatId, message);
    } catch {
      // ignore send failures
    }
  };

  async function getChannelDisplayName(): Promise<string> {
    if (!channelId) return "User";
    const { data } = await supabase
      .from("channels")
      .select("display_name, platform_uid")
      .eq("id", channelId)
      .single();
    return data?.display_name || data?.platform_uid || "User";
  }

  async function broadcastRoomToChannels(roomId: string, roomTitle: string, excludeChannelId?: string | null) {
    const { buildRoomUrl } = await import("@/lib/room-token");
    const { data: channels } = await supabase
      .from("channels")
      .select("id, platform, platform_uid, display_name, is_allowed, is_owner")
      .eq("agent_id", agentId)
      .eq("is_allowed", true);

    if (!channels) return;

    const { getSenderForAgent } = await import("@/lib/platform/sender");
    for (const ch of channels) {
      if (!ch.platform_uid || ch.id === excludeChannelId) continue;
      try {
        const url = buildRoomUrl(roomId, ch.id, ch.platform, ch.display_name || ch.platform_uid, ch.is_owner);
        const chSender = await getSenderForAgent(agentId, ch.platform);
        if (chSender) {
          await chSender.sendMarkdown(
            ch.platform_uid,
            t("roomBroadcast", { title: roomTitle, url })
          );
        }
      } catch { /* skip channels that fail */ }
    }
  }

  return {
    create_chat_room: tool({
      description: "Create a cross-platform realtime chatroom. A shareable web link will be generated and broadcast to all approved channels. Only the owner can invoke this. IMPORTANT: The returned `url` contains a cryptographic auth token — you MUST send it to the user EXACTLY as-is. Never modify, shorten, or reconstruct the URL.",
      inputSchema: z.object({
        title: z.string().optional().describe("Optional chatroom title"),
      }),
      execute: async ({ title }: { title?: string }) => {
        if (!isOwner) {
          await sendToCurrent(t("roomOwnerOnly"));
          return { success: false, error: "Only the owner can create chatrooms" };
        }
        try {
          const roomTitle = title || `Room ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
          const { data: room, error } = await supabase
            .from("chat_rooms")
            .insert({
              agent_id: agentId,
              created_by: channelId || null,
              title: roomTitle,
            })
            .select()
            .single();
          if (error || !room) {
            await sendToCurrent(t("roomCreateFailed"));
            return { success: false, error: error?.message ?? "Insert failed" };
          }

          const { buildRoomUrl } = await import("@/lib/room-token");
          const ownerName = await getChannelDisplayName();
          const ownerUrl = buildRoomUrl(room.id, channelId || null, platform || "web", ownerName, true);

          await supabase.from("chat_room_messages").insert({
            room_id: room.id,
            sender_type: "system",
            sender_name: "System",
            content: `Chatroom "${roomTitle}" created`,
          });

          if (sender && platformChatId) {
            await sender.sendMarkdown(
              platformChatId,
              t("roomCreated", { title: roomTitle, url: ownerUrl })
            );
          }

          await broadcastRoomToChannels(room.id, roomTitle, channelId);

          return { success: true, room_id: room.id, title: roomTitle, message: "Chatroom created and link sent." };
        } catch (err) {
          await sendToCurrent(t("roomCreateFailed"));
          return { success: false, error: err instanceof Error ? err.message : "Failed" };
        }
      },
    }),

    close_chat_room: tool({
      description: "Close an active chatroom. Only the owner can invoke this.",
      inputSchema: z.object({
        room_id: z.string().optional().describe("Specific room ID to close. If omitted, closes the most recent active room for this agent."),
      }),
      execute: async ({ room_id }: { room_id?: string }) => {
        if (!isOwner) {
          await sendToCurrent(t("roomOwnerOnly"));
          return { success: false, error: "Only the owner can close chatrooms" };
        }
        try {
          let targetId = room_id;
          if (!targetId) {
            const { data: rooms } = await supabase
              .from("chat_rooms")
              .select("id")
              .eq("agent_id", agentId)
              .eq("status", "active")
              .order("created_at", { ascending: false })
              .limit(1);
            if (!rooms || rooms.length === 0) {
              await sendToCurrent(t("roomNoActive"));
              return { success: false, error: "No active chatroom found" };
            }
            targetId = rooms[0].id;
          }

          const { data: roomMeta } = await supabase
            .from("chat_rooms")
            .select("title")
            .eq("id", targetId)
            .single();
          const roomTitle = roomMeta?.title || "Chatroom";

          const { error } = await supabase
            .from("chat_rooms")
            .update({ status: "closed", closed_at: new Date().toISOString() })
            .eq("id", targetId);
          if (error) return { success: false, error: error.message };

          await supabase.from("chat_room_messages").insert({
            room_id: targetId,
            sender_type: "system",
            sender_name: "System",
            content: "Chatroom has been closed by the owner.",
          });

          if (sender && platformChatId) {
            await sender.sendMarkdown(
              platformChatId,
              t("roomClosed", { title: roomTitle })
            );
          }

          return { success: true, room_id: targetId };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Failed" };
        }
      },
    }),

    reopen_chat_room: tool({
      description: "Reopen a previously closed chatroom. The same room ID and link will become active again. Only the owner can invoke this.",
      inputSchema: z.object({
        room_id: z.string().optional().describe("Specific room ID to reopen. If omitted, reopens the most recently closed room for this agent."),
      }),
      execute: async ({ room_id }: { room_id?: string }) => {
        if (!isOwner) {
          await sendToCurrent(t("roomOwnerOnly"));
          return { success: false, error: "Only the owner can reopen chatrooms" };
        }
        try {
          let targetId = room_id;
          if (!targetId) {
            const { data: rooms } = await supabase
              .from("chat_rooms")
              .select("id")
              .eq("agent_id", agentId)
              .eq("status", "closed")
              .order("closed_at", { ascending: false })
              .limit(1);
            if (!rooms || rooms.length === 0) {
              await sendToCurrent(t("roomNoClosed"));
              return { success: false, error: "No closed chatroom found" };
            }
            targetId = rooms[0].id;
          }

          const { error } = await supabase
            .from("chat_rooms")
            .update({ status: "active", closed_at: null })
            .eq("id", targetId)
            .eq("status", "closed");
          if (error) return { success: false, error: error.message };

          await supabase.from("chat_room_messages").insert({
            room_id: targetId,
            sender_type: "system",
            sender_name: "System",
            content: "Chatroom has been reopened.",
          });

          const { data: roomData } = await supabase
            .from("chat_rooms")
            .select("title")
            .eq("id", targetId)
            .single();

          const roomTitle = roomData?.title || "Chatroom";

          if (sender && platformChatId) {
            const { buildRoomUrl } = await import("@/lib/room-token");
            const ownerName = await getChannelDisplayName();
            const ownerUrl = buildRoomUrl(targetId!, channelId || null, platform || "web", ownerName, true);
            await sender.sendMarkdown(
              platformChatId,
              t("roomReopened", { title: roomTitle, url: ownerUrl })
            );
          }

          await broadcastRoomToChannels(targetId!, roomTitle, channelId);

          return { success: true, room_id: targetId, message: "Chatroom reopened and link sent." };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Failed" };
        }
      },
    }),
  };
}

export const SUB_APP_TOOL_NAMES = ["create_chat_room", "close_chat_room", "reopen_chat_room"] as const;

function getUtcOffset(date: Date, timezone: string): string {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = date.toLocaleString("en-US", { timeZone: timezone });
  const diffMs = new Date(localStr).getTime() - new Date(utcStr).getTime();
  const diffHours = diffMs / 3600000;
  const sign = diffHours >= 0 ? "+" : "-";
  const abs = Math.abs(diffHours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `UTC${sign}${h}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}`;
}
