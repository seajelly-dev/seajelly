import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { createR2Client, testR2Connection } from "@/lib/jellybox/r2-client";

export async function POST(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const { endpoint, access_key_id, secret_access_key, bucket_name } = await request.json();
  if (!endpoint || !access_key_id || !secret_access_key || !bucket_name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const client = createR2Client({ endpoint, accessKeyId: access_key_id, secretAccessKey: secret_access_key });
  const result = await testR2Connection(client, bucket_name);
  return NextResponse.json(result);
}
