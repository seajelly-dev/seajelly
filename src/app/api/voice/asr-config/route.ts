import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto/encrypt";
import { GATEWAY_CAPABILITIES } from "@/lib/gateway/capabilities";
import { buildGatewayRouteUrl, findGatewayCapability, getGatewayConnection } from "@/lib/gateway/client";
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
      const gateway = await getGatewayConnection();
      if (gateway) {
        const route = findGatewayCapability(gateway.manifest, GATEWAY_CAPABILITIES.doubaoAsrWs);
        if (!route) {
          return NextResponse.json(
            { error: `Gateway capability missing: ${GATEWAY_CAPABILITIES.doubaoAsrWs}` },
            { status: 500 },
          );
        }

        const proxyUrl = buildGatewayRouteUrl(gateway.url, route.path, {
          transport: "ws",
          includeSecretQuery: true,
          secret: gateway.secret,
        });
        return NextResponse.json({ engine, proxyUrl });
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get ASR config" },
      { status: 500 },
    );
  }
}
