import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import { Sandbox } from "@e2b/code-interpreter";
import { getE2BApiKey } from "@/lib/e2b/sandbox";

export async function DELETE(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const apiKey = await getE2BApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "E2B_API_KEY not configured" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sandboxId = searchParams.get("id");

  if (!sandboxId) {
    return NextResponse.json(
      { error: "Sandbox id is required" },
      { status: 400 }
    );
  }

  try {
    const sbx = await Sandbox.connect(sandboxId, { apiKey });
    await sbx.kill();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to close sandbox" },
      { status: 500 }
    );
  }
}
