import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getSecret(key: string): Promise<string | null> {
  const db = createClient(supabaseUrl, supabaseKey);
  const { data } = await db
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", key)
    .single();
  if (!data?.encrypted_value) return null;
  try { return decrypt(data.encrypted_value); } catch { return null; }
}

function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  tolerance = 300,
): boolean {
  const elements = sigHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];
  for (const el of elements) {
    const [key, val] = el.split("=");
    if (key === "t") timestamp = val;
    if (key === "v1") signatures.push(val);
  }
  if (!timestamp || signatures.length === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > tolerance) return false;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return signatures.some((sig) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig)));
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");
  if (!sigHeader) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const webhookSecret = await getSecret("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const channelId = (session.client_reference_id as string) ||
      (session.metadata as Record<string, string>)?.channel_id;

    if (!channelId) {
      console.warn("[stripe-webhook] No channel_id found in session");
      return NextResponse.json({ received: true });
    }

    const planId = (session.metadata as Record<string, string>)?.plan_id;
    const db = createClient(supabaseUrl, supabaseKey);

    let planType: "time" | "quota" = "time";
    let durationDays = 30;
    let quotaAmount = 100;

    if (planId) {
      const { data: plan } = await db
        .from("subscription_plans")
        .select("*")
        .eq("id", planId)
        .single();
      if (plan) {
        planType = plan.type;
        durationDays = plan.duration_days ?? 30;
        quotaAmount = plan.quota_amount ?? 100;
      }
    } else {
      const { data: channel } = await db
        .from("channels")
        .select("agent_id")
        .eq("id", channelId)
        .single();

      if (channel) {
        const { data: plans } = await db
          .from("subscription_plans")
          .select("*")
          .eq("agent_id", channel.agent_id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .limit(1);
        if (plans?.[0]) {
          planType = plans[0].type;
          durationDays = plans[0].duration_days ?? 30;
          quotaAmount = plans[0].quota_amount ?? 100;
        }
      }
    }

    const now = new Date();
    const insertData: Record<string, unknown> = {
      channel_id: channelId,
      plan_id: planId || null,
      type: planType,
      status: "active",
      payment_provider: "stripe",
      payment_id: (session.payment_intent as string) || (session.id as string),
    };

    if (planType === "time") {
      insertData.starts_at = now.toISOString();
      insertData.expires_at = new Date(now.getTime() + durationDays * 86400000).toISOString();
    } else {
      insertData.quota_total = quotaAmount;
      insertData.quota_used = 0;
    }

    const { error } = await db
      .from("channel_subscriptions")
      .insert(insertData);

    if (error) {
      console.error("[stripe-webhook] Failed to create subscription:", error.message);
    } else {
      console.log(`[stripe-webhook] Subscription activated for channel ${channelId}`);
      await db
        .from("channels")
        .update({ is_allowed: true })
        .eq("id", channelId);
    }
  }

  return NextResponse.json({ received: true });
}
