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

    const link = await loadValidVoiceTempLink(token, "asr");
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

    const engine = (link.config as Record<string, string>)?.engine || settings.asr_engine || "gemini-asr";

    if (engine === "doubao-asr") {
      // Try Edge Gateway first (doubao credentials stored in voice_settings, gateway fetches from Supabase)
      const { data: gwRows } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", ["gateway_url", "gateway_secret"]);
      const gw: Record<string, string> = {};
      for (const r of gwRows || []) gw[r.key] = r.value;

      if (gw.gateway_url && gw.gateway_secret) {
        const wsUrl = `${gw.gateway_url.replace(/^http/, "ws").replace(/\/$/, "")}/ws/doubao-asr?secret=${encodeURIComponent(gw.gateway_secret)}`;
        return NextResponse.json({ engine, proxyUrl: wsUrl });
      }

      // Fallback: legacy direct proxy URL
      const proxyUrl = settings.doubao_proxy_url || "";
      if (!proxyUrl) {
        return NextResponse.json({ error: "Doubao ASR requires Edge Gateway or a proxy URL to be configured" }, { status: 500 });
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
