import { NextResponse } from "next/server";
import { authErrorResponse, createStrictServiceClient, requireAdmin } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const { html, title } = (await request.json()) as {
      html: string;
      title?: string;
    };

    if (!html) {
      return NextResponse.json({ error: "html is required" }, { status: 400 });
    }

    const supabase = createStrictServiceClient();
    const { data, error } = await supabase
      .from("html_previews")
      .insert({ html, title: title || "Untitled" })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to store preview" },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    const previewUrl = `${baseUrl}/preview/${data.id}`;

    return NextResponse.json({ id: data.id, previewUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
