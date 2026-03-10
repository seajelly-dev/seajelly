import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

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

    const { data: link } = await supabase
      .from("voice_temp_links")
      .select("*")
      .eq("id", token)
      .eq("type", "asr")
      .single();

    if (!link || new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
    }

    const { data: settingsRows } = await supabase
      .from("voice_settings")
      .select("key, value");
    const settings: Record<string, string> = {};
    for (const row of settingsRows || []) {
      settings[row.key] = row.value;
    }

    const engine = (link.config as Record<string, string>)?.engine || settings.asr_engine || "gemini-asr";

    if (engine === "doubao-asr") {
      const proxyUrl = settings.doubao_proxy_url || "";
      if (!proxyUrl) {
        return NextResponse.json({ error: "Doubao proxy URL not configured" }, { status: 500 });
      }
      return NextResponse.json({ engine, proxyUrl });
    }

    const { data: keyRow } = await supabase
      .from("voice_api_keys")
      .select("encrypted_value")
      .eq("engine", engine)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!keyRow) {
      return NextResponse.json({ error: `No API key configured for ASR engine: ${engine}` }, { status: 500 });
    }

    return NextResponse.json({
      engine,
      apiKey: decrypt(keyRow.encrypted_value),
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
    });
  } catch (err) {
    console.error("ASR config error:", err);
    return NextResponse.json({ error: "Failed to get ASR config" }, { status: 500 });
  }
}
