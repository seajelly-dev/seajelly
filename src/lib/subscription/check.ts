import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "@/types/database";
import type { Locale } from "@/lib/i18n/types";
import { botT, getBotLocaleOrDefault } from "@/lib/i18n/bot";
import type { PlatformSender } from "@/lib/platform/types";

export type SubscriptionCheckResult =
  | { allowed: true; message?: string }
  | { allowed: false; message: string };

interface CheckParams {
  supabase: SupabaseClient;
  agentId: string;
  channel: Channel;
  sender: PlatformSender;
  platformChatId: string;
  agentLocale?: string | null;
}

export async function checkSubscription(params: CheckParams): Promise<SubscriptionCheckResult> {
  const { supabase, agentId, channel, sender, platformChatId, agentLocale } = params;
  const locale: Locale = getBotLocaleOrDefault(agentLocale);

  const { data: allActiveSubs } = await supabase
    .from("channel_subscriptions")
    .select("*")
    .eq("channel_id", channel.id)
    .eq("status", "active");

  const activeSub = pickBestSubscription(allActiveSubs ?? []);

  if (activeSub) {
    if (activeSub.type === "time") {
      const now = new Date();
      const expiresAt = activeSub.expires_at ? new Date(activeSub.expires_at) : null;

      if (expiresAt && now >= expiresAt) {
        await supabase
          .from("channel_subscriptions")
          .update({ status: "expired" })
          .eq("id", activeSub.id);
        await sender.sendText(platformChatId, botT(locale, "subscriptionExpired"));
        return await handleNoSubscription(params, locale);
      }

      if (expiresAt && !activeSub.reminder_sent) {
        const { data: rule } = await supabase
          .from("subscription_rules")
          .select("expire_reminder_days")
          .eq("agent_id", agentId)
          .maybeSingle();
        const reminderDays = rule?.expire_reminder_days ?? 3;
        const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= reminderDays) {
          await sender.sendText(platformChatId, botT(locale, "subscriptionExpiringSoon", { days: daysLeft }));
          await supabase
            .from("channel_subscriptions")
            .update({ reminder_sent: true })
            .eq("id", activeSub.id);
        }
      }

      return { allowed: true };
    }

    if (activeSub.type === "quota") {
      const total = activeSub.quota_total ?? 0;
      const used = activeSub.quota_used ?? 0;
      if (used >= total) {
        await supabase
          .from("channel_subscriptions")
          .update({ status: "expired" })
          .eq("id", activeSub.id);
        await sender.sendText(platformChatId, botT(locale, "quotaExhausted"));
        return await handleNoSubscription(params, locale);
      }

      await supabase
        .from("channel_subscriptions")
        .update({ quota_used: used + 1 })
        .eq("id", activeSub.id);

      const remaining = total - used - 1;
      if (remaining <= 5 && remaining > 0) {
        return { allowed: true, message: botT(locale, "quotaRemaining", { n: remaining }) };
      }
      return { allowed: true };
    }
  }

  return await handleNoSubscription(params, locale);
}

async function handleNoSubscription(
  params: CheckParams,
  locale: Locale,
): Promise<SubscriptionCheckResult> {
  const { supabase, agentId, channel, sender, platformChatId } = params;

  const { data: rule } = await supabase
    .from("subscription_rules")
    .select("*")
    .eq("agent_id", agentId)
    .maybeSingle();

  const trialCount = rule?.trial_count ?? 3;
  const fallbackAction = rule?.fallback_action ?? "require_approval";

  if (channel.trial_used < trialCount) {
    await supabase
      .from("channels")
      .update({ trial_used: channel.trial_used + 1 })
      .eq("id", channel.id);

    const remaining = trialCount - channel.trial_used - 1;
    if (remaining > 0) {
      return { allowed: true, message: botT(locale, "trialRemaining", { n: remaining }) };
    }
    return { allowed: true };
  }

  if (fallbackAction === "require_payment") {
    const { data: plans } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (plans && plans.length > 0) {
      let msg = botT(locale, "trialExhausted") + "\n" + botT(locale, "subscriptionRequired") + "\n\n";
      let hasAnyLink = false;
      for (const plan of plans) {
        const priceStr = formatPrice(plan.price_cents, plan.currency);
        const desc = plan.type === "time"
          ? botT(locale, "planDescDays", { n: plan.duration_days ?? 0 })
          : botT(locale, "planDescMessages", { n: plan.quota_amount ?? 0 });
        msg += botT(locale, "subscriptionPlanItem", { name: plan.name, price: priceStr, desc }) + "\n";
        if (plan.stripe_payment_link) {
          hasAnyLink = true;
          const linkWithRef = appendClientRef(plan.stripe_payment_link, channel.id);
          msg += botT(locale, "subscriptionPayHere", { url: linkWithRef }) + "\n\n";
        }
      }
      if (!hasAnyLink) {
        msg += "\n" + botT(locale, "subscriptionContactAdmin") + "\n";
      }
      await sender.sendMarkdown(platformChatId, msg);
      return { allowed: false, message: "[subscription_required]" };
    }

    return { allowed: false, message: botT(locale, "trialExhausted") };
  }

  if (channel.is_allowed) {
    return { allowed: true };
  }
  return { allowed: false, message: "[pending_approval]" };
}

function formatPrice(cents: number, currency: string): string {
  const symbols: Record<string, string> = { usd: "$", cny: "¥", eur: "€", gbp: "£" };
  const sym = symbols[currency.toLowerCase()] || currency.toUpperCase() + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function appendClientRef(paymentLink: string, channelId: string): string {
  try {
    const url = new URL(paymentLink);
    url.searchParams.set("client_reference_id", channelId);
    return url.toString();
  } catch {
    return paymentLink;
  }
}

function pickBestSubscription(
  subs: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (subs.length === 0) return null;
  if (subs.length === 1) return subs[0];

  const timeSubs = subs.filter((s) => s.type === "time" && s.expires_at);
  if (timeSubs.length > 0) {
    timeSubs.sort(
      (a, b) =>
        new Date(b.expires_at as string).getTime() -
        new Date(a.expires_at as string).getTime(),
    );
    return timeSubs[0];
  }

  const quotaSubs = subs.filter((s) => s.type === "quota");
  if (quotaSubs.length > 0) {
    quotaSubs.sort(
      (a, b) =>
        ((b.quota_total as number) - (b.quota_used as number)) -
        ((a.quota_total as number) - (a.quota_used as number)),
    );
    return quotaSubs[0];
  }

  return subs[0];
}
