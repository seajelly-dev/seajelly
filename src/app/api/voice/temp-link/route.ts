import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, createStrictServiceClient, requireAdmin } from "@/lib/supabase/server";
import { loadValidVoiceTempLink } from "@/lib/voice/temp-links";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const link = await loadValidVoiceTempLink(token);
    if (!link) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    return NextResponse.json({
      type: link.type,
      config: link.config,
      expiresAt: link.expires_at,
    });
  } catch (err) {
    console.error("Temp link GET error:", err);
    return NextResponse.json({ error: "Failed to verify link" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const { type, agentId, channelId, config } = await req.json();

    if (!type || !["live", "asr"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const supabase = createStrictServiceClient();
    const { data, error } = await supabase
      .from("voice_temp_links")
      .insert({
        type,
        agent_id: agentId || null,
        channel_id: channelId || null,
        config: config || {},
      })
      .select("id, expires_at")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to create temp link");
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const path = type === "live" ? "voice/live" : "voice/asr";
    const url = `${baseUrl}/${path}/${data.id}`;

    return NextResponse.json({
      token: data.id,
      url,
      expiresAt: data.expires_at,
    });
  } catch (err) {
    console.error("Temp link POST error:", err);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}
