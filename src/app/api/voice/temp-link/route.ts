import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("voice_temp_links")
      .select("*")
      .eq("id", token)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    if (new Date(data.expires_at) < new Date()) {
      return NextResponse.json({ error: "Link expired" }, { status: 410 });
    }

    return NextResponse.json({
      type: data.type,
      config: data.config,
      agentId: data.agent_id,
      expiresAt: data.expires_at,
    });
  } catch (err) {
    console.error("Temp link GET error:", err);
    return NextResponse.json({ error: "Failed to verify link" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { type, agentId, channelId, config } = await req.json();

    if (!type || !["live", "asr"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const supabase = getSupabase();
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
