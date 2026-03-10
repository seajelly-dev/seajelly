import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto/encrypt";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [settingsRes, keysRes] = await Promise.all([
      supabase.from("voice_settings").select("key, value"),
      supabase.from("voice_api_keys").select("id, engine, label, extra_config, is_active, created_at"),
    ]);

    const settings: Record<string, string> = {};
    for (const row of settingsRes.data || []) {
      settings[row.key] = row.value;
    }

    return NextResponse.json({
      settings,
      keys: keysRes.data || [],
    });
  } catch (err) {
    console.error("Voice GET error:", err);
    return NextResponse.json({ error: "Failed to load voice config" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === "update_settings") {
      const { settings } = body as { settings: Record<string, string> };
      for (const [key, value] of Object.entries(settings)) {
        await supabase
          .from("voice_settings")
          .upsert({ key, value }, { onConflict: "key" });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_key") {
      const { engine, apiKey, label, extraConfig } = body;
      if (!engine || !apiKey) {
        return NextResponse.json({ error: "engine and apiKey required" }, { status: 400 });
      }

      const existing = await supabase
        .from("voice_api_keys")
        .select("id")
        .eq("engine", engine)
        .limit(1)
        .maybeSingle();

      if (existing.data) {
        await supabase
          .from("voice_api_keys")
          .update({
            encrypted_value: encrypt(apiKey),
            label: label || "",
            extra_config: extraConfig || {},
            is_active: true,
          })
          .eq("id", existing.data.id);
      } else {
        await supabase.from("voice_api_keys").insert({
          engine,
          encrypted_value: encrypt(apiKey),
          label: label || "",
          extra_config: extraConfig || {},
        });
      }

      return NextResponse.json({ success: true });
    }

    if (action === "delete_key") {
      const { keyId } = body;
      if (!keyId) return NextResponse.json({ error: "keyId required" }, { status: 400 });
      await supabase.from("voice_api_keys").delete().eq("id", keyId);
      return NextResponse.json({ success: true });
    }

    if (action === "test_key") {
      const { engine } = body;
      if (!engine) return NextResponse.json({ error: "engine required" }, { status: 400 });

      const { data: keyRow } = await supabase
        .from("voice_api_keys")
        .select("encrypted_value")
        .eq("engine", engine)
        .eq("is_active", true)
        .limit(1)
        .single();

      if (!keyRow) {
        return NextResponse.json({ error: "No active key for this engine" }, { status: 404 });
      }

      try {
        decrypt(keyRow.encrypted_value);
        return NextResponse.json({ success: true, message: "Key decrypted successfully" });
      } catch {
        return NextResponse.json({ error: "Key decryption failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Voice PUT error:", err);
    return NextResponse.json({ error: "Failed to update voice config" }, { status: 500 });
  }
}
