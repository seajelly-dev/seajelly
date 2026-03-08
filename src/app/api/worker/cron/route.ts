import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBotForAgent } from "@/lib/telegram/bot";
import { runAgentLoop } from "@/lib/agent/loop";
import { unscheduleCronJob } from "@/lib/supabase/management";
import type { AgentEvent } from "@/types/database";

export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function getTaskJobName(taskConfig: unknown): string | null {
  if (!taskConfig || typeof taskConfig !== "object") return null;
  const raw = (taskConfig as Record<string, unknown>).job_name;
  return typeof raw === "string" ? raw : null;
}

async function disableLocalCronJobs(agentId: string, jobName: string): Promise<number> {
  const supabase = getSupabase();
  const { data: rows, error: listErr } = await supabase
    .from("cron_jobs")
    .select("id, task_config")
    .eq("agent_id", agentId)
    .eq("enabled", true);

  if (listErr) {
    console.warn("Once cleanup local-list failed:", listErr.message);
    return 0;
  }

  const ids = (rows ?? [])
    .filter((r) => getTaskJobName(r.task_config) === jobName)
    .map((r) => r.id as string);

  if (ids.length === 0) return 0;

  const { error: updateErr } = await supabase
    .from("cron_jobs")
    .update({ enabled: false, last_run: new Date().toISOString() })
    .in("id", ids);

  if (updateErr) {
    console.warn("Once cleanup local-update failed:", updateErr.message);
    return 0;
  }

  return ids.length;
}

export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { task_type, agent_id, chat_id, platform_chat_id: pci, ...rest } = body;
    const platformChatId = String(pci || chat_id || "");

    if (!agent_id || !platformChatId) {
      return NextResponse.json(
        { error: "Missing agent_id or chat_id" },
        { status: 400 }
      );
    }

    const type = task_type || "reminder";
    const tgChatId = Number(platformChatId);

    switch (type) {
      case "reminder": {
        const { message } = rest;
        if (!message) {
          return NextResponse.json(
            { error: "Missing message for reminder" },
            { status: 400 }
          );
        }
        const bot = await getBotForAgent(agent_id);
        await bot.api
          .sendMessage(tgChatId, `🔔 ${message}`, { parse_mode: "Markdown" })
          .catch(async () => {
            await bot.api.sendMessage(tgChatId, `🔔 ${message}`);
          });
        break;
      }

      case "agent_invoke": {
        const { prompt } = rest;
        if (!prompt) {
          return NextResponse.json(
            { error: "Missing prompt for agent_invoke" },
            { status: 400 }
          );
        }
        const event: AgentEvent = {
          id: crypto.randomUUID(),
          source: "cron",
          agent_id,
          platform_chat_id: platformChatId,
          dedup_key: null,
          payload: {
            message: { text: prompt },
            platform_uid: platformChatId,
          },
          status: "processing",
          locked_until: null,
          retry_count: 0,
          max_retries: 0,
          error_message: null,
          trace_id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          processed_at: null,
        };
        await runAgentLoop(event);
        break;
      }

      case "webhook": {
        return NextResponse.json(
          { error: "webhook task_type is not yet implemented" },
          { status: 501 }
        );
      }

      default:
        return NextResponse.json(
          { error: `Unknown task_type: ${type}` },
          { status: 400 }
        );
    }

    // For one-shot tasks, mark local rows disabled immediately (authoritative UI state),
    // then unschedule pg_cron in background.
    let localDisabled = 0;
    const onceJobName =
      rest.once && typeof rest.job_name === "string" ? rest.job_name : null;
    if (onceJobName) {
      localDisabled = await disableLocalCronJobs(agent_id, onceJobName);
      after(async () => {
        try {
          await unscheduleCronJob(onceJobName);
        } catch (e) {
          console.warn("One-shot cleanup failed:", e);
        }
      });
    }

    return NextResponse.json({
      success: true,
      task_type: type,
      once_cleanup: onceJobName ? { local_disabled: localDisabled } : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron worker error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
