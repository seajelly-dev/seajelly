import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function getAgentLocale(agentId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from("agents").select("bot_locale").eq("id", agentId).single();
  return (data as { bot_locale?: string } | null)?.bot_locale ?? null;
}

interface ChannelApprovalParams {
  action: "approve" | "reject";
  channelId: string;
  callerUid: string;
  fallbackAgentId: string | null;
}

interface ChannelApprovalResult {
  agentId: string;
  name: string;
  targetUid: string;
  targetPlatform: string;
}

export async function processChannelApproval(
  params: ChannelApprovalParams,
): Promise<ChannelApprovalResult | null> {
  const { action, channelId, callerUid, fallbackAgentId } = params;
  const supabase = getSupabase();

  const { data: ch } = await supabase
    .from("channels")
    .select("id, agent_id, platform, platform_uid, display_name, is_allowed")
    .eq("id", channelId)
    .single();

  if (!ch) return null;

  const agentId = ch.agent_id || fallbackAgentId;
  if (!agentId) return null;

  const { data: ownerCh } = await supabase
    .from("channels")
    .select("platform_uid")
    .eq("agent_id", agentId)
    .eq("is_owner", true)
    .single();

  if (!ownerCh || ownerCh.platform_uid !== callerUid) return null;

  const name = ch.display_name || ch.platform_uid;

  if (action === "approve") {
    if (ch.is_allowed) return null;
    await supabase.from("channels").update({ is_allowed: true }).eq("id", channelId);
  } else {
    await supabase.from("channels").delete().eq("id", channelId);
  }

  return { agentId, name, targetUid: ch.platform_uid, targetPlatform: ch.platform };
}
