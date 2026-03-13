import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto/encrypt";
import { createStrictServiceClient } from "@/lib/supabase/server";
import { loadValidVoiceTempLink } from "@/lib/voice/temp-links";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const link = await loadValidVoiceTempLink(token, "live");
    if (!link) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
    }

    const supabase = createStrictServiceClient();

    const { data: settingsRows } = await supabase
      .from("voice_settings")
      .select("key, value");
    const settings: Record<string, string> = {};
    for (const row of settingsRows || []) {
      settings[row.key] = row.value;
    }

    const engine = (link.config as Record<string, string>)?.engine || settings.live_engine || "gemini-live";
    const voice = (link.config as Record<string, string>)?.voice || settings.live_voice || "Aoede";

    const { data: keyRow } = await supabase
      .from("voice_api_keys")
      .select("encrypted_value")
      .eq("engine", engine)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!keyRow) {
      return NextResponse.json({ error: "No API key configured for live engine" }, { status: 500 });
    }

    const apiKey = decrypt(keyRow.encrypted_value);

    return NextResponse.json({
      apiKey,
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      voice,
    });
  } catch (err) {
    console.error("Live config error:", err);
    return NextResponse.json({ error: "Failed to get live config" }, { status: 500 });
  }
}
