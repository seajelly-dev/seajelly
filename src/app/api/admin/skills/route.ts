import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("skills")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ skills: data ?? [] });
}

export async function POST(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, content, tool_schema, source_url } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let finalContent = content || "";

  if (source_url && !content) {
    try {
      const res = await fetch(source_url, {
        headers: { Accept: "text/plain, text/markdown, */*" },
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${res.status} ${res.statusText}` },
          { status: 400 }
        );
      }
      finalContent = await res.text();
    } catch (err) {
      return NextResponse.json(
        {
          error: `URL fetch error: ${err instanceof Error ? err.message : "Unknown"}`,
        },
        { status: 400 }
      );
    }
  }

  if (!finalContent.trim()) {
    return NextResponse.json(
      { error: "content is required (provide directly or via source_url)" },
      { status: 400 }
    );
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("skills")
    .insert({
      name,
      description: description || "",
      content: finalContent,
      tool_schema: tool_schema || null,
      source_url: source_url || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ skill: data });
}

export async function PUT(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = await createAdminClient();
  const { data, error } = await db
    .from("skills")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ skill: data });
}

export async function DELETE(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = await createAdminClient();
  const { error } = await db.from("skills").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
