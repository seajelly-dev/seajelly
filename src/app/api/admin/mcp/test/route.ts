import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { testMCPConnection } from "@/lib/mcp/client";
import { validateExternalUrl, SSRFError } from "@/lib/security/url-validator";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { url, transport, headers } = body;

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    await validateExternalUrl(url);
  } catch (err) {
    const msg = err instanceof SSRFError ? err.message : "Invalid URL";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const result = await testMCPConnection(
    url,
    transport || "http",
    headers || {}
  );

  return NextResponse.json(result);
}
