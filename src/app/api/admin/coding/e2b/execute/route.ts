import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse } from "@/lib/supabase/server";
import {
  getE2BApiKey,
  runPythonCode,
  runJavaScriptCode,
  runHTMLPreview,
  saveHTMLPreview,
} from "@/lib/e2b/sandbox";

export const maxDuration = 60;

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const body = await request.json();
  const { language, code } = body as { language: string; code: string };

  if (!language || !code) {
    return NextResponse.json(
      { error: "language and code are required" },
      { status: 400 }
    );
  }

  if (language === "html") {
    try {
      const result = runHTMLPreview(code);
      const saved = await saveHTMLPreview(code);
      return NextResponse.json({ ...result, previewUrl: saved.previewUrl });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Preview failed" },
        { status: 500 }
      );
    }
  }

  const apiKey = await getE2BApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "E2B_API_KEY not configured. Add it in Dashboard > Secrets." },
      { status: 400 }
    );
  }

  try {
    if (language === "python") {
      const result = await runPythonCode(apiKey, code);
      return NextResponse.json(result);
    }

    if (language === "javascript") {
      const result = await runJavaScriptCode(apiKey, code);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Unsupported language: ${language}` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Execution failed" },
      { status: 500 }
    );
  }
}
