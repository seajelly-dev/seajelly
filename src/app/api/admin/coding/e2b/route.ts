import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { getE2BApiKey, testConnection } from "@/lib/e2b/sandbox";

export async function GET() {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const apiKey = await getE2BApiKey();

  return NextResponse.json({
    configured: !!apiKey,
  });
}

export async function POST() {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const apiKey = await getE2BApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "E2B_API_KEY not configured. Add it in Secrets." },
      { status: 400 }
    );
  }

  const result = await testConnection(apiKey);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}
