import { NextResponse } from "next/server";
import { claimPendingEvents, markProcessed, markFailed } from "@/lib/events/queue";
import { runAgentLoop } from "@/lib/agent/loop";
import {
  listActiveGithubBuildJobs,
  syncGithubBuildJobStatus,
  expireStaleGithubBuildJobs,
  cleanupExpiredStepLogs,
} from "@/lib/github/jobs";

export const maxDuration = 300;

async function pollBuildJobs(limit = 10): Promise<{
  active: number;
  synced: number;
  expired: number;
}> {
  const expired = await expireStaleGithubBuildJobs();
  const activeJobs = await listActiveGithubBuildJobs(limit);
  let synced = 0;
  for (const job of activeJobs) {
    try {
      await syncGithubBuildJobStatus(job.id);
      synced += 1;
    } catch {
      // Keep polling best-effort; single job failure should not stop worker loop.
    }
  }
  return { active: activeJobs.length, synced, expired };
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
    const pollBefore = await pollBuildJobs();
    const events = await claimPendingEvents();

    if (events.length === 0) {
      const cleanedSteps = await cleanupExpiredStepLogs();
      return NextResponse.json({ processed: 0, buildJobs: pollBefore, cleanedStepLogs: cleanedSteps });
    }

    const results = [];

    for (const event of events) {
      try {
        const result = await runAgentLoop(event);
        if (result.success) {
          await markProcessed(event.id);
          results.push({ id: event.id, status: "processed", traceId: event.trace_id });
        } else {
          await markFailed(event.id, result.error ?? "Unknown failure");
          results.push({ id: event.id, status: "failed", error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await markFailed(event.id, msg);
        results.push({ id: event.id, status: "failed", error: msg });
      }
    }

    const pollAfter = await pollBuildJobs();
    const cleanedSteps = await cleanupExpiredStepLogs();

    return NextResponse.json({
      processed: results.filter((r) => r.status === "processed").length,
      failed: results.filter((r) => r.status === "failed").length,
      buildJobs: {
        before: pollBefore,
        after: pollAfter,
      },
      cleanedStepLogs: cleanedSteps,
      results,
    });
  } catch (err) {
    console.error("Worker error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Worker failed" },
      { status: 500 }
    );
  }
}
