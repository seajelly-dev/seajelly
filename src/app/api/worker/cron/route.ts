import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSenderForAgent } from "@/lib/platform/sender";
import { runAgentLoop } from "@/lib/agent/loop";
import { unscheduleCronJob } from "@/lib/supabase/management";
import {
  disableOwnedLocalCronJobs,
  type ScheduledJobScope,
} from "@/lib/agent/scheduled-jobs";
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
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let onceJobName: string | null = null;
  let oncePgCronJobName: string | null = null;
  let cleanupScope: ScheduledJobScope | null = null;

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
    const platform = (rest.platform as string) || "telegram";
    if (rest.once && typeof rest.job_name === "string") {
      onceJobName = rest.job_name;
      oncePgCronJobName =
        typeof rest.pg_cron_job_name === "string"
          ? rest.pg_cron_job_name
          : rest.job_name;
      cleanupScope = { agentId: agent_id, platformChatId, platform };
    }

    switch (type) {
      case "reminder": {
        const { message } = rest;
        if (!message) {
          return NextResponse.json(
            { error: "Missing message for reminder" },
            { status: 400 }
          );
        }
        const sender = await getSenderForAgent(agent_id, platform);
        await sender.sendMarkdown(platformChatId, `🔔 ${message}`);
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
            platform,
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

    return NextResponse.json({
      success: true,
      task_type: type,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron worker error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (onceJobName && oncePgCronJobName && cleanupScope) {
      const localDisabled = await disableOwnedLocalCronJobs(
        getSupabase(),
        cleanupScope,
        onceJobName,
        { markLastRun: true }
      );
      if (localDisabled.error) {
        console.warn("Once cleanup local-update failed:", localDisabled.error);
      }
      console.log(`Once cleanup: ${onceJobName} disabled ${localDisabled.updated} local rows`);
      after(async () => {
        try {
          await unscheduleCronJob(oncePgCronJobName!);
        } catch (e) {
          console.warn("One-shot pg_cron cleanup failed:", e);
        }
      });
    }
  }
}
