import { NextResponse } from "next/server";
import {
  authErrorResponse,
  createAdminClient,
  requireAdmin,
} from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import { clearSecretsCache } from "@/lib/secrets";
import {
  checkVercelDeployment,
  getVercelProject,
  VercelApiError,
} from "@/lib/github/api";

type VercelDiagnosticCode =
  | "project_access_ok"
  | "bad_token"
  | "project_not_found"
  | "project_access_denied"
  | "deployments_read_failed"
  | "unknown";

function buildVercelErrorResponse(code: VercelDiagnosticCode, error: string) {
  return NextResponse.json(
    {
      error,
      errorCode: code,
      success: false,
    },
    { status: 400 },
  );
}

async function readSavedVercelConfig() {
  const supabase = await createAdminClient();
  const [tokenRow, projectRow] = await Promise.all([
    supabase.from("secrets").select("encrypted_value").eq("key_name", "VERCEL_TOKEN").single(),
    supabase
      .from("secrets")
      .select("encrypted_value")
      .eq("key_name", "VERCEL_PROJECT_ID")
      .single(),
  ]);

  const { decrypt } = await import("@/lib/crypto/encrypt");

  return {
    token: tokenRow.data?.encrypted_value ? decrypt(tokenRow.data.encrypted_value) : "",
    projectId: projectRow.data?.encrypted_value ? decrypt(projectRow.data.encrypted_value) : "",
  };
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authErrorResponse(e);
  }

  const { action, token, projectId } = (await request.json()) as {
    action: "save" | "test";
    token?: string;
    projectId?: string;
  };

  if (action === "save") {
    const supabase = await createAdminClient();
    const trimmedToken = token?.trim() ?? "";
    const trimmedProjectId = projectId?.trim() ?? "";
    if (!trimmedToken && !trimmedProjectId) {
      return NextResponse.json(
        { error: "VERCEL_TOKEN or VERCEL_PROJECT_ID is required" },
        { status: 400 },
      );
    }

    const writes = [];
    if (trimmedToken) {
      writes.push(
        supabase
          .from("secrets")
          .upsert(
            { key_name: "VERCEL_TOKEN", encrypted_value: encrypt(trimmedToken) },
            { onConflict: "key_name" },
          ),
      );
    }
    if (trimmedProjectId) {
      writes.push(
        supabase
          .from("secrets")
          .upsert(
            { key_name: "VERCEL_PROJECT_ID", encrypted_value: encrypt(trimmedProjectId) },
            { onConflict: "key_name" },
          ),
      );
    }

    const results = await Promise.all(writes);
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }

    clearSecretsCache();
    return NextResponse.json({ success: true });
  }

  if (action === "test") {
    const trimmedToken = token?.trim() ?? "";
    const trimmedProjectId = projectId?.trim() ?? "";
    const saved = await readSavedVercelConfig();

    const resolvedToken = trimmedToken || saved.token;
    const resolvedProjectId = trimmedProjectId || saved.projectId;

    if (!resolvedToken || !resolvedProjectId) {
      return NextResponse.json(
        { error: "VERCEL_TOKEN or VERCEL_PROJECT_ID is not configured" },
        { status: 400 },
      );
    }

    try {
      const project = await getVercelProject(resolvedToken, resolvedProjectId);
      try {
        await checkVercelDeployment(
          resolvedToken,
          resolvedProjectId,
          "__seajelly_vercel_diagnostic__",
        );
      } catch (err) {
        if (err instanceof VercelApiError) {
          return buildVercelErrorResponse(
            "deployments_read_failed",
            "Vercel can find this project, but deployment listing still failed. Re-check the token owner, the project binding, and whether this token can access deployment data for the same project.",
          );
        }
        return buildVercelErrorResponse(
          "unknown",
          err instanceof Error ? err.message : "Vercel deployment check failed",
        );
      }

      return NextResponse.json({
        success: true,
        diagnosisCode: "project_access_ok",
        projectId: project.id,
        projectName: project.name,
        framework: project.framework,
      });
    } catch (err) {
      if (err instanceof VercelApiError) {
        if (err.invalidToken || err.status === 401) {
          return buildVercelErrorResponse(
            "bad_token",
            "Vercel rejected this token. Re-copy it and make sure it has not expired or been revoked.",
          );
        }
        if (err.status === 404) {
          return buildVercelErrorResponse(
            "project_not_found",
            "Vercel could not find this project. Double-check the Project ID from Project Settings -> General -> Project ID, then save it again.",
          );
        }
        if (err.status === 403) {
          return buildVercelErrorResponse(
            "project_access_denied",
            "This token is valid, but it cannot access the configured Vercel project. Make sure the token belongs to the same Vercel account or team that owns this project.",
          );
        }
      }

      return buildVercelErrorResponse(
        "unknown",
        err instanceof Error ? err.message : "Vercel connection failed",
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
