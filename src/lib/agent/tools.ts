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
import type { PlatformSender } from "@/lib/platform/types";
import { generateTTS, logTTSUsage, getVoiceSettings } from "@/lib/voice/tts-engine";
import { isTextTooLong } from "@/lib/voice/tts-config-data";

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

export function createAgentTools({ agentId, channelId, isOwner, sender, platformChatId }: ToolsOptions) {
  const supabase = getSupabase();

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

        const chatIdResult = await supabase
          .from("sessions")
          .select("platform_chat_id")
          .eq("agent_id", agentId)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        if (!chatIdResult.data?.platform_chat_id) {
          return { success: false, error: "No active chat session found" };
        }

        const chatId = chatIdResult.data.platform_chat_id;

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
        "Execute Python code in a secure E2B cloud sandbox. Returns stdout, stderr, and any " +
        "generated charts/images as base64 PNG. The sandbox has internet access and common " +
        "libraries pre-installed (numpy, pandas, matplotlib, etc). " +
        "Each execution creates a fresh sandbox (stateless). Sandbox max lifetime: 1 hour (Hobby plan).",
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
        "Execute JavaScript/TypeScript code in a secure E2B cloud sandbox. Returns stdout and stderr. " +
        "Supports top-level await, ESM imports, and Node.js APIs. Each execution creates a fresh sandbox.",
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
        "Preview HTML/CSS/JS by storing the HTML and returning a permanent public URL. " +
        "The preview link never expires and does not require login to access. " +
        "No E2B sandbox or credits are consumed. " +
        "Include all CSS and JS inline in the HTML for best results.",
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
        "List files in the project's GitHub repository. " +
        "Returns a flat list of file paths (excludes node_modules, .git, dist, lock files). " +
        "Use this to understand the project structure before reading specific files.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory path to filter by, e.g. 'src/components'. Empty = entire repo"),
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
          return { success: true, files, count: files.length };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "List failed" };
        }
      },
    }),

    github_build_verify: tool({
      description:
        "Clone the project repo into an E2B sandbox, apply code changes, and run a build to verify. " +
        "This is an ASYNC operation — it immediately returns a sandbox_id. " +
        "You MUST then call github_build_status to poll for the result. " +
        "Use this to validate code changes before committing to the main branch. " +
        "Requires E2B_API_KEY, GITHUB_TOKEN, and GITHUB_REPO to be configured.",
      inputSchema: z.object({
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .describe("Files to create or modify, with paths relative to repo root"),
        delete_files: z
          .array(z.string())
          .optional()
          .describe("Files to delete, paths relative to repo root"),
        install_cmd: z.string().optional().describe("Custom install command, default: npm install"),
        build_cmd: z.string().optional().describe("Custom build command, default: npm run build"),
        serve_cmd: z.string().optional().describe("Custom serve command for previewing the build output"),
        port: z.number().optional().describe("Port for the preview server, default: 3000"),
      }),
      execute: async (params: {
        files: { path: string; content: string }[];
        delete_files?: string[];
        install_cmd?: string;
        build_cmd?: string;
        serve_cmd?: string;
        port?: number;
      }) => {
        const apiKey = await getE2BApiKey();
        if (!apiKey) {
          return { success: false, error: "E2B_API_KEY not configured." };
        }
        const { token, repo } = await getGitHubConfig();
        if (!token || !repo) {
          return { success: false, error: "GITHUB_TOKEN or GITHUB_REPO not configured." };
        }
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
          return {
            success: true,
            sandboxId: result.sandboxId,
            message: "Build started. Use github_build_status to check progress.",
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Build start failed" };
        }
      },
    }),

    github_build_status: tool({
      description:
        "Check the status of an async build verification started by github_build_verify. " +
        "Returns 'building' if still in progress, 'success' with a preview URL, or 'failed' with error logs. " +
        "Poll this every ~15 seconds after starting a build.",
      inputSchema: z.object({
        sandbox_id: z.string().describe("The sandbox ID returned by github_build_verify"),
        port: z.number().optional().describe("Port the preview server uses, default: 3000"),
      }),
      execute: async ({ sandbox_id, port }: { sandbox_id: string; port?: number }) => {
        const apiKey = await getE2BApiKey();
        if (!apiKey) {
          return { success: false, error: "E2B_API_KEY not configured." };
        }
        try {
          const status = await checkBuildStatus(apiKey, sandbox_id, port);
          return { success: true, ...status };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : "Status check failed" };
        }
      },
    }),

    github_request_push_approval: tool({
      description:
        "Request an explicit, one-time owner approval to commit and push code changes to GitHub. " +
        "This sends an Approve/Reject button to the owner and returns an approval_id. " +
        "You MUST wait until the approval is granted before calling github_commit_push.",
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
        expires_in_minutes?: number;
      }) => {
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

        const filePaths = params.files.map((f) => f.path).sort();
        const deletePaths = [...(params.delete_files ?? [])].sort();
        const payloadHash = computePushPayloadHash(params);

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
          return { success: false, error: err instanceof Error ? err.message : "Failed to send approval request." };
        }

        return {
          success: true,
          approvalId: inserted.id,
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
          .select("id, status, expires_at, approved_at, rejected_at, used_at")
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
          .select("id, status, payload_hash, branch, commit_message, expires_at, used_at")
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
          await supabase
            .from("github_push_approvals")
            .update({ status: "used", used_at: new Date().toISOString() })
            .eq("id", params.approval_id);
          return {
            success: true,
            commitSha: result.commitSha,
            commitUrl: result.commitUrl,
            message: `Committed and pushed: ${result.commitUrl}`,
          };
        } catch (err) {
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
            await sender.sendVoice(platformChatId, audioBuffer, "voice.wav");
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

  if (channelId) {
    return { ...baseTools, ...ttsTools, ...buildSoulTools(channelId, !!isOwner) };
  }
  return { ...baseTools, ...ttsTools };
}

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
