import { createStrictServiceClient } from "@/lib/supabase/server";

export type VoiceTempLinkType = "live" | "asr";

export interface VoiceTempLinkRecord {
  id: string;
  type: VoiceTempLinkType;
  agent_id: string | null;
  channel_id: string | null;
  config: Record<string, string>;
  expires_at: string;
}

export async function loadValidVoiceTempLink(
  token: string,
  expectedType?: VoiceTempLinkType
): Promise<VoiceTempLinkRecord | null> {
  const supabase = createStrictServiceClient();
  let query = supabase
    .from("voice_temp_links")
    .select("id, type, agent_id, channel_id, config, expires_at")
    .eq("id", token);

  if (expectedType) {
    query = query.eq("type", expectedType);
  }

  const { data, error } = await query.single();
  if (error || !data) {
    return null;
  }

  if (new Date(data.expires_at) < new Date()) {
    return null;
  }

  return {
    ...data,
    config: (data.config ?? {}) as Record<string, string>,
  };
}
