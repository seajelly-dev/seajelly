import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const view = searchParams.get("view") || "plans";

  if (view === "plans") {
    let q = db
      .from("subscription_plans")
      .select("*, agents:agent_id(name)")
      .order("sort_order", { ascending: true });
    if (agentId) q = q.eq("agent_id", agentId);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plans: data });
  }

  if (view === "subscriptions") {
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let countQ = db
      .from("channel_subscriptions")
      .select("id", { count: "exact", head: true });
    let q = db
      .from("channel_subscriptions")
      .select("*, channels:channel_id(id, display_name, platform_uid, platform, agent_id, agents:agent_id(name)), plans:plan_id(name, type)")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (agentId) {
      countQ = countQ.eq("channels.agent_id", agentId);
      q = q.eq("channels.agent_id", agentId);
    }

    const { count } = await countQ;
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ subscriptions: data, total: count ?? 0 });
  }

  if (view === "rules") {
    let q = db.from("subscription_rules").select("*");
    if (agentId) q = q.eq("agent_id", agentId);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rules: data });
  }

  return NextResponse.json({ error: "Invalid view" }, { status: 400 });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const body = await request.json();
  const { action } = body;

  if (action === "create_plan") {
    const { agent_id, name, type, duration_days, quota_amount, price_cents, currency, stripe_payment_link, sort_order } = body;
    if (!agent_id || !name || !type || price_cents == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const { data, error } = await db
      .from("subscription_plans")
      .insert({
        agent_id,
        name,
        type,
        duration_days: type === "time" ? (duration_days || 30) : null,
        quota_amount: type === "quota" ? (quota_amount || 100) : null,
        price_cents,
        currency: currency || "usd",
        stripe_payment_link: stripe_payment_link || null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plan: data });
  }

  if (action === "grant_subscription") {
    const { channel_id, plan_id, type, duration_days, quota_total } = body;
    if (!channel_id || !type) {
      return NextResponse.json({ error: "channel_id and type required" }, { status: 400 });
    }
    const now = new Date();
    const insertData: Record<string, unknown> = {
      channel_id,
      plan_id: plan_id || null,
      type,
      status: "active",
      payment_provider: "manual",
    };
    if (type === "time") {
      const days = duration_days || 30;
      insertData.starts_at = now.toISOString();
      insertData.expires_at = new Date(now.getTime() + days * 86400000).toISOString();
    } else {
      insertData.quota_total = quota_total || 100;
      insertData.quota_used = 0;
    }
    const { data, error } = await db
      .from("channel_subscriptions")
      .insert(insertData)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ subscription: data });
  }

  if (action === "upsert_rule") {
    const { agent_id, trial_count, fallback_action, expire_reminder_days } = body;
    if (!agent_id) return NextResponse.json({ error: "agent_id required" }, { status: 400 });
    const { data, error } = await db
      .from("subscription_rules")
      .upsert({
        agent_id,
        trial_count: trial_count ?? 3,
        fallback_action: fallback_action || "require_approval",
        expire_reminder_days: expire_reminder_days ?? 3,
      }, { onConflict: "agent_id" })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rule: data });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function PUT(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const body = await request.json();
  const { id, target, ...updates } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (target === "plan") {
    const allowed = ["name", "type", "duration_days", "quota_amount", "price_cents", "currency", "stripe_payment_link", "is_active", "sort_order"];
    const filtered: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in updates) filtered[k] = updates[k];
    }
    const { data, error } = await db
      .from("subscription_plans")
      .update(filtered)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plan: data });
  }

  if (target === "subscription") {
    const allowed = ["status", "expires_at", "quota_total", "quota_used"];
    const filtered: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in updates) filtered[k] = updates[k];
    }
    const { data, error } = await db
      .from("channel_subscriptions")
      .update(filtered)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ subscription: data });
  }

  return NextResponse.json({ error: "target must be 'plan' or 'subscription'" }, { status: 400 });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) { return authErrorResponse(e); }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const target = searchParams.get("target") || "plan";

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const table = target === "subscription" ? "channel_subscriptions" : "subscription_plans";
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
