import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET || "opencrab-cron";

  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { task_type, agent_id, chat_id, ...rest } = body;

    if (!agent_id || !chat_id) {
      return NextResponse.json(
        { error: "Missing agent_id or chat_id" },
        { status: 400 }
      );
    }

    const type = task_type || "reminder";

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
          .sendMessage(chat_id, `🔔 ${message}`, { parse_mode: "Markdown" })
          .catch(async () => {
            await bot.api.sendMessage(chat_id, `🔔 ${message}`);
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
          chat_id,
          dedup_key: null,
          payload: {
            message: { text: prompt },
            platform_uid: String(chat_id),
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
        // TODO: implement external webhook POST
        // const { url, payload } = rest;
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

    // One-shot task cleanup: unschedule from pg_cron + mark disabled in cron_jobs
    if (rest.once && rest.job_name) {
      try {
        await unscheduleCronJob(rest.job_name);
        const supabase = getSupabase();
        await supabase
          .from("cron_jobs")
          .update({ enabled: false })
          .eq("agent_id", agent_id)
          .filter("task_config->>'job_name'", "eq", rest.job_name);
      } catch (e) {
        console.warn("One-shot cleanup failed:", e);
      }
    }

    return NextResponse.json({ success: true, task_type: type });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron worker error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
