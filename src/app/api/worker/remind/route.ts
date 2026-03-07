import { NextResponse } from "next/server";
import { POST as cronHandler } from "@/app/api/worker/cron/route";

/**
 * Legacy compatibility endpoint.
 * Old pg_cron jobs may still target /api/worker/remind.
 * Injects task_type:"reminder" and forwards to the generalized cron worker.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const enriched = { ...body, task_type: "reminder" };

    const enrichedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(enriched),
    });

    return cronHandler(enrichedRequest);
  } catch {
    return NextResponse.json(
      { error: "Failed to forward to cron worker" },
      { status: 500 }
    );
  }
}
