import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { testMCPConnection } from "@/lib/mcp/client";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { url, transport, headers } = body;

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const result = await testMCPConnection(
    url,
    transport || "http",
    headers || {}
  );

  return NextResponse.json(result);
}
