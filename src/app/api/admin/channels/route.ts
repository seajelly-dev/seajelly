import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { getSenderForAgent } from "@/lib/platform/sender";
import { getAgentLocale } from "@/lib/platform/approval-core";
import { botT, getBotLocaleOrDefault, buildWelcomeText } from "@/lib/i18n/bot";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const platform = searchParams.get("platform");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("page_size") ?? "20", 10))
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  function applyFilters<T extends { eq: (col: string, val: string) => T; or: (filter: string) => T; ilike: (col: string, pat: string) => T }>(q: T) {
    if (agentId) q = q.eq("agent_id", agentId);
    if (platform) q = q.eq("platform", platform);
    if (search) q = q.or(`display_name.ilike.%${search}%,platform_uid.ilike.%${search}%`);
    return q;
  }

  let countQuery = db
    .from("channels")
    .select("id", { count: "exact", head: true });
  countQuery = applyFilters(countQuery);
  const { count } = await countQuery;

  let query = db
    .from("channels")
    .select("*, agents:agent_id(name)")
    .order("created_at", { ascending: false })
    .range(from, to);
  query = applyFilters(query);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channels: data, total: count ?? 0 });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowed = ["is_allowed", "display_name", "user_soul", "is_owner"];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in updates) filtered[key] = updates[key];
  }

  if (filtered.is_owner === true) {
    const { data: ch } = await db.from("channels").select("agent_id").eq("id", id).single();
    if (ch) {
      await db.from("channels").update({ is_owner: false }).eq("agent_id", ch.agent_id).eq("is_owner", true);
    }
  }

  const { data: before } = await db
    .from("channels")
    .select("is_allowed, platform, platform_uid, agent_id")
    .eq("id", id)
    .single();

  const { data, error } = await db
    .from("channels")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before && filtered.is_allowed !== undefined && before.is_allowed !== filtered.is_allowed) {
    const approved = filtered.is_allowed === true;
    after(async () => {
      await notifyApprovalResult(before.agent_id, before.platform, before.platform_uid, approved);
    });
  }

  return NextResponse.json({ channel: data });
}

async function notifyApprovalResult(
  agentId: string,
  platform: string,
  platformUid: string,
  approved: boolean,
) {
  try {
    const rawLocale = await getAgentLocale(agentId);
    const locale = getBotLocaleOrDefault(rawLocale);
    const sender = await getSenderForAgent(agentId, platform);
    await sender.sendText(
      platformUid,
      approved
        ? botT(locale, "accessApproved")
        : botT(locale, "accessRevoked"),
    );
    if (approved) {
      const db = (await import("@/lib/supabase/server")).createAdminClient;
      const supabase = await db();
      const { data: aRow } = await supabase.from("agents").select("name").eq("id", agentId).single();
      const agentName = (aRow as { name?: string } | null)?.name || "Agent";
      await sender.sendMarkdown(platformUid, buildWelcomeText(locale, agentName, platform));
    }
  } catch (err) {
    console.error("notifyApprovalResult failed:", platform, platformUid, err);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await db.from("channels").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
