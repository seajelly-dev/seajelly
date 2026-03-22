import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { botT, buildWelcomeText, getBotLocaleOrDefault } from "@/lib/i18n/bot";
import { checkSubscription } from "@/lib/subscription/check";
import { getSenderForAgent } from "@/lib/platform/sender";
import type { PlatformSender } from "@/lib/platform/types";
import type { Agent, Channel, Session } from "@/types/database";

interface ResolveChannelParams {
  supabase: SupabaseClient;
  agent: Agent;
  platform: string;
  platformUid: string | null;
  platformChatId: string;
  displayName: string | null;
  msgPayload?: Record<string, unknown>;
}

interface EnforceChannelAccessParams {
  supabase: SupabaseClient;
  agent: Agent;
  channel: Channel | null;
  sender: PlatformSender;
  platformChatId: string;
}

interface FindOrCreateSessionParams {
  supabase: SupabaseClient;
  agentId: string;
  platformChatId: string;
  channel: Channel | null;
}

export interface ChannelAccessResult {
  allowed: boolean;
  reply?: string;
}

export async function resolveOrCreateChannel(
  params: ResolveChannelParams,
): Promise<Channel | null> {
  const { supabase, agent, platform, platformUid, platformChatId, displayName, msgPayload } = params;
  if (!platformUid) return null;

  const { data: existingChannel } = await supabase
    .from("channels")
    .select("*")
    .eq("agent_id", agent.id)
    .eq("platform", platform)
    .eq("platform_uid", platformUid)
    .single();

  if (existingChannel) {
    return existingChannel as Channel;
  }

  let resolvedDisplayName = displayName;
  if (!resolvedDisplayName && msgPayload) {
    const fromData = msgPayload.from as Record<string, unknown> | undefined;
    resolvedDisplayName = (fromData?.first_name as string) || null;
  }

  const { count: existingCount } = await supabase
    .from("channels")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agent.id);
  const isFirstChannel = (existingCount ?? 0) === 0;
  const autoAllow =
    agent.access_mode === "open" || agent.access_mode === "subscription" || isFirstChannel;

  const { data: newChannel } = await supabase
    .from("channels")
    .insert({
      agent_id: agent.id,
      platform,
      platform_uid: platformUid,
      display_name: resolvedDisplayName || null,
      is_allowed: autoAllow,
      is_owner: isFirstChannel,
    })
    .select()
    .single();

  const channel = newChannel as Channel | null;
  if (channel && !isFirstChannel) {
    await notifyOwnerOfNewChannel(agent.id, channel, agent.access_mode === "approval").catch((err) => {
      console.error("notifyOwnerOfNewChannel failed:", err);
    });
  }

  if (channel && autoAllow) {
    sendWelcomeMessage(agent.id, platform, platformChatId, agent.name, agent.bot_locale).catch(() => {});
  }

  return channel;
}

export async function enforceChannelAccess(
  params: EnforceChannelAccessParams,
): Promise<ChannelAccessResult> {
  const { supabase, agent, channel, sender, platformChatId } = params;
  if (!channel) {
    if (agent.access_mode === "approval" || agent.access_mode === "subscription") {
      return { allowed: false, reply: "[no_channel_created]" };
    }
    return { allowed: true };
  }

  if (!channel.is_allowed) {
    const locale = getBotLocaleOrDefault(agent.bot_locale);
    await sender.sendText(platformChatId, botT(locale, "pendingApproval"));
    return { allowed: false, reply: "[pending_approval]" };
  }

  if (agent.access_mode !== "subscription") {
    return { allowed: true };
  }

  const subResult = await checkSubscription({
    supabase,
    agentId: agent.id,
    channel,
    sender,
    platformChatId,
    agentLocale: agent.bot_locale,
  });
  if (!subResult.allowed) {
    if (subResult.message === "[pending_approval]") {
      const locale = getBotLocaleOrDefault(agent.bot_locale);
      const { data: freshCh } = await supabase
        .from("channels")
        .select("is_allowed")
        .eq("id", channel.id)
        .single();
      const alreadyLocked = freshCh && !freshCh.is_allowed;
      if (!alreadyLocked) {
        await supabase.from("channels").update({ is_allowed: false }).eq("id", channel.id);
        await notifyOwnerOfNewChannel(agent.id, channel, true).catch(() => {});
        await sender.sendText(platformChatId, botT(locale, "trialExhaustedApproval"));
      } else {
        await sender.sendText(platformChatId, botT(locale, "pendingApproval"));
      }
    }
    return { allowed: false, reply: subResult.message };
  }

  if (subResult.message) {
    sender.sendText(platformChatId, subResult.message).catch(() => {});
  }
  return { allowed: true };
}

export async function findOrCreateActiveSession(
  params: FindOrCreateSessionParams,
): Promise<Session> {
  const { supabase, agentId, platformChatId, channel } = params;

  let { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("platform_chat_id", platformChatId)
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .single();

  if (!session) {
    const { data: newSession, error: insertErr } = await supabase
      .from("sessions")
      .insert({
        platform_chat_id: platformChatId,
        agent_id: agentId,
        channel_id: channel?.id || null,
        messages: [],
        version: 1,
        is_active: true,
      })
      .select()
      .single();

    if (insertErr || !newSession) {
      throw new Error(`Failed to create session: ${insertErr?.message}`);
    }
    session = newSession;
  } else if (channel && !session.channel_id) {
    await supabase
      .from("sessions")
      .update({ channel_id: channel.id })
      .eq("id", session.id);
  }

  return session as Session;
}

async function notifyOwnerOfNewChannel(
  agentId: string,
  newChannel: Channel,
  needsApproval: boolean = false,
) {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const [{ data: ownerChannel }, { data: agentRow }] = await Promise.all([
    supa
      .from("channels")
      .select("platform, platform_uid")
      .eq("agent_id", agentId)
      .eq("is_owner", true)
      .single(),
    supa.from("agents").select("bot_locale").eq("id", agentId).single(),
  ]);

  const locale = getBotLocaleOrDefault((agentRow as { bot_locale?: string } | null)?.bot_locale);

  if (!ownerChannel) {
    console.warn("notifyOwner: no owner channel found for agent", agentId);
    return;
  }

  let ownerSender: PlatformSender;
  try {
    ownerSender = await getSenderForAgent(agentId, ownerChannel.platform);
  } catch (err) {
    console.error("notifyOwner: getSenderForAgent failed:", ownerChannel.platform, err);
    return;
  }

  const name = newChannel.display_name || newChannel.platform_uid;
  const params = { name, platform: newChannel.platform, uid: newChannel.platform_uid };
  const text = needsApproval
    ? botT(locale, "notifyApprovalRequest", params)
    : botT(locale, "notifyNewUser", params);

  try {
    if (needsApproval) {
      await ownerSender.sendInteractiveButtons(
        ownerChannel.platform_uid,
        text,
        [[
          { label: botT(locale, "approveButton"), callbackData: `approve:${newChannel.id}` },
          { label: botT(locale, "rejectButton"), callbackData: `reject:${newChannel.id}` },
        ]],
        { parseMode: "Markdown" },
      );
    } else {
      await ownerSender.sendMarkdown(ownerChannel.platform_uid, text);
    }
  } catch (err) {
    console.error("notifyOwner: send failed:", ownerChannel.platform, ownerChannel.platform_uid, err);
  }
}

async function sendWelcomeMessage(
  agentId: string,
  platform: string,
  platformChatId: string,
  agentName: string,
  agentLocale?: string | null,
) {
  try {
    const locale = getBotLocaleOrDefault(agentLocale);
    const welcomeText = buildWelcomeText(locale, agentName, platform);
    const sender = await getSenderForAgent(agentId, platform);
    await sender.sendMarkdown(platformChatId, welcomeText);
  } catch (err) {
    console.warn("sendWelcomeMessage failed (non-blocking):", err);
  }
}

