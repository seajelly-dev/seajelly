import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import {
  ROOM_SUB_APP_SLUG,
  getRoomSubAppConfigStatus,
} from "@/lib/sub-app-settings";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const subAppId = searchParams.get("sub_app_id");

  const db = await createAdminClient();

  if (agentId) {
    const { data, error } = await db
      .from("agent_sub_apps")
      .select("sub_app_id")
      .eq("agent_id", agentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sub_app_ids: (data ?? []).map((r) => r.sub_app_id) });
  }

  if (subAppId) {
    const { data, error } = await db
      .from("agent_sub_apps")
      .select("agent_id")
      .eq("sub_app_id", subAppId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ agent_ids: (data ?? []).map((r) => r.agent_id) });
  }

  const { data, error } = await db
    .from("sub_apps")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let roomConfig:
    | {
        complete: boolean;
        configuredKeys: string[];
        missingKeys: string[];
      }
    | null = null;

  try {
    const status = await getRoomSubAppConfigStatus();
    roomConfig = {
      complete: status.complete,
      configuredKeys: status.configuredKeys,
      missingKeys: status.missingKeys,
    };
  } catch {
    roomConfig = null;
  }

  return NextResponse.json({
    sub_apps: (data ?? []).map((subApp) =>
      subApp.slug === ROOM_SUB_APP_SLUG
        ? {
            ...subApp,
            config_complete: roomConfig?.complete ?? false,
            config_configured_keys: roomConfig?.configuredKeys ?? [],
            config_missing_keys: roomConfig?.missingKeys ?? [],
          }
        : subApp,
    ),
  });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const db = await createAdminClient();

  if (body.sub_app_id && Array.isArray(body.agent_ids)) {
    await db.from("agent_sub_apps").delete().eq("sub_app_id", body.sub_app_id);
    if (body.agent_ids.length > 0) {
      const rows = body.agent_ids.map((aid: string) => ({
        agent_id: aid,
        sub_app_id: body.sub_app_id,
      }));
      const { error } = await db.from("agent_sub_apps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, agent_ids: body.agent_ids });
  }

  if (body.agent_id && Array.isArray(body.sub_app_ids)) {
    await db.from("agent_sub_apps").delete().eq("agent_id", body.agent_id);
    if (body.sub_app_ids.length > 0) {
      const rows = body.sub_app_ids.map((sid: string) => ({
        agent_id: body.agent_id,
        sub_app_id: sid,
      }));
      const { error } = await db.from("agent_sub_apps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, sub_app_ids: body.sub_app_ids });
  }

  if (body.id && typeof body.enabled === "boolean") {
    const { data, error } = await db
      .from("sub_apps")
      .update({ enabled: body.enabled })
      .eq("id", body.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sub_app: data });
  }

  return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
}
