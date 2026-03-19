import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse, createAdminClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import { parseRepo } from "@/lib/github/config";
import { clearSecretsCache } from "@/lib/secrets";
import { getRepoInfo } from "@/lib/github/api";

export async function GET() {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const supabase = await createAdminClient();

  const [tokenRow, repoRow, vercelTokenRow, vercelProjectRow] = await Promise.all([
    supabase.from("secrets").select("encrypted_value").eq("key_name", "GITHUB_TOKEN").single(),
    supabase.from("system_settings").select("value").eq("key", "github_repo").single(),
    supabase.from("secrets").select("encrypted_value").eq("key_name", "VERCEL_TOKEN").single(),
    supabase.from("secrets").select("encrypted_value").eq("key_name", "VERCEL_PROJECT_ID").single(),
  ]);

  return NextResponse.json({
    tokenConfigured: !!tokenRow.data?.encrypted_value,
    repo: repoRow.data?.value || "",
    vercelConfigured: !!vercelTokenRow.data?.encrypted_value && !!vercelProjectRow.data?.encrypted_value,
  });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch (e) {
    return authErrorResponse(e);
  }

  const { action, token, repo } = (await request.json()) as {
    action: "save" | "test";
    token?: string;
    repo?: string;
  };

  if (action === "save") {
    const supabase = await createAdminClient();

    const trimmedRepo = repo?.trim() ?? "";
    if (trimmedRepo) {
      try {
        parseRepo(trimmedRepo);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid repository format" },
          { status: 400 }
        );
      }
    }

    if (token) {
      const encrypted = encrypt(token);
      const { error } = await supabase
        .from("secrets")
        .upsert({ key_name: "GITHUB_TOKEN", encrypted_value: encrypted }, { onConflict: "key_name" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      clearSecretsCache();
    }

    if (repo !== undefined) {
      const { error } = await supabase
        .from("system_settings")
        .upsert({ key: "github_repo", value: trimmedRepo }, { onConflict: "key" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  }

  if (action === "test") {
    const supabase = await createAdminClient();

    const [tokenRow, repoRow] = await Promise.all([
      supabase.from("secrets").select("encrypted_value").eq("key_name", "GITHUB_TOKEN").single(),
      supabase.from("system_settings").select("value").eq("key", "github_repo").single(),
    ]);

    if (!tokenRow.data?.encrypted_value || !repoRow.data?.value) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN or GITHUB_REPO not configured" },
        { status: 400 }
      );
    }

    const { decrypt } = await import("@/lib/crypto/encrypt");
    const ghToken = decrypt(tokenRow.data.encrypted_value);
    const repoName = repoRow.data.value;
    try {
      parseRepo(repoName);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid repository format" },
        { status: 400 }
      );
    }

    try {
      const repoInfo = await getRepoInfo(ghToken, repoName);
      if (!repoInfo.canPush) {
        return NextResponse.json(
          { error: "Token can read the repository but does not have push permission." },
          { status: 400 }
        );
      }
      const { error: branchErr } = await supabase
        .from("system_settings")
        .upsert(
          { key: "github_default_branch", value: repoInfo.defaultBranch },
          { onConflict: "key" }
        );
      if (branchErr) {
        return NextResponse.json({ error: branchErr.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        defaultBranch: repoInfo.defaultBranch,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Connection failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
