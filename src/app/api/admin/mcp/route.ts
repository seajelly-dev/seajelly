import { NextResponse } from "next/server";
import { requireAdmin, createAdminClient, authErrorResponse } from "@/lib/supabase/server";
import { validateExternalUrl, SSRFError } from "@/lib/security/url-validator";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("mcp_servers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ servers: data ?? [] });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { name, url, transport, headers, enabled } = body;

  if (!name || !url) {
    return NextResponse.json(
      { error: "name and url are required" },
      { status: 400 }
    );
  }

  try {
    await validateExternalUrl(url);
  } catch (err) {
    const msg = err instanceof SSRFError ? err.message : "Invalid URL";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("mcp_servers")
    .insert({
      name,
      url,
      transport: transport || "http",
      headers: headers || {},
      enabled: enabled ?? true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ server: data });
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (updates.url) {
    try {
      await validateExternalUrl(updates.url);
    } catch (err) {
      const msg = err instanceof SSRFError ? err.message : "Invalid URL";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("mcp_servers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ server: data });
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = await createAdminClient();
  const { error } = await db.from("mcp_servers").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
