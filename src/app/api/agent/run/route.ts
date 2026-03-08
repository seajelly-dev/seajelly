import { NextResponse } from "next/server";
import { runAgentLoop } from "@/lib/agent/loop";
import type { AgentEvent } from "@/types/database";

export const maxDuration = 300;

export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const incoming = request.headers.get("x-cron-secret");
  if (incoming !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const event: AgentEvent = await request.json();
    const result = await runAgentLoop(event);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Agent run error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
