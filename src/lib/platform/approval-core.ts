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

interface PushApprovalParams {
  action: "approve" | "reject";
  approvalId: string;
  callerUid: string;
  fallbackAgentId: string | null;
}

interface PushApprovalResult {
  agentId: string;
  status: "expired" | "already_processed" | "processed";
  summary: string;
  requesterUid: string | null;
}

export async function processPushApproval(
  params: PushApprovalParams,
): Promise<PushApprovalResult | null> {
  const { action, approvalId, callerUid, fallbackAgentId } = params;
  const supabase = getSupabase();

  const { data: approval } = await supabase
    .from("github_push_approvals")
    .select("id, agent_id, request_channel_id, status, branch, commit_message, expires_at")
    .eq("id", approvalId)
    .single();

  if (!approval) return null;

  const agentId = approval.agent_id || fallbackAgentId;
  if (!agentId) return null;

  const { data: ownerCh } = await supabase
    .from("channels")
    .select("platform_uid")
    .eq("agent_id", agentId)
    .eq("is_owner", true)
    .single();

  if (!ownerCh || ownerCh.platform_uid !== callerUid) return null;

  const summary =
    `*Branch:* \`${approval.branch}\`\n` +
    `*Message:* ${approval.commit_message}\n`;

  const expiresAt = new Date(approval.expires_at as string).getTime();
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    if (approval.status === "pending") {
      await supabase
        .from("github_push_approvals")
        .update({ status: "expired" })
        .eq("id", approvalId);
    }
    return { agentId, status: "expired", summary, requesterUid: null };
  }

  if (approval.status !== "pending") {
    return { agentId, status: "already_processed", summary, requesterUid: null };
  }

  let requesterUid: string | null = null;
  if (approval.request_channel_id) {
    const { data: requestCh } = await supabase
      .from("channels")
      .select("platform_uid")
      .eq("id", approval.request_channel_id)
      .single();
    requesterUid = requestCh?.platform_uid || null;
  }

  if (action === "approve") {
    await supabase
      .from("github_push_approvals")
      .update({
        status: "approved",
        approved_by_uid: callerUid,
        approved_at: new Date().toISOString(),
      })
      .eq("id", approvalId);
  } else {
    await supabase
      .from("github_push_approvals")
      .update({
        status: "rejected",
        approved_by_uid: callerUid,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", approvalId);
  }

  return { agentId, status: "processed", summary, requesterUid };
}
