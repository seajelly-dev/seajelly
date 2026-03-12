import { NextResponse } from "next/server";
import { claimPendingEvents, markProcessed, markFailed } from "@/lib/events/queue";
import { runAgentLoop } from "@/lib/agent/loop";

export const maxDuration = 300;

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
    const events = await claimPendingEvents();

    if (events.length === 0) {
      return NextResponse.json({ processed: 0 });
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

    return NextResponse.json({
      processed: results.filter((r) => r.status === "processed").length,
      failed: results.filter((r) => r.status === "failed").length,
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
