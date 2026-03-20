import { NextResponse } from "next/server";
import { requireAdmin, authErrorResponse, createAdminClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";
import { parseRepo } from "@/lib/github/config";
import { clearSecretsCache } from "@/lib/secrets";
import { compareCommits, getBranchHeadSha, getRepoInfo } from "@/lib/github/api";

type GitHubDiagnosticCode =
  | "core_access_ok"
  | "workflow_write_recommended"
  | "bad_credentials"
  | "repo_not_found_or_not_selected"
  | "repo_pending_approval_or_denied"
  | "contents_read_missing"
  | "contents_write_missing"
  | "unknown";

function extractGitHubStatus(message: string): number | null {
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

function buildGitHubErrorResponse(code: GitHubDiagnosticCode, error: string) {
  return NextResponse.json(
    {
      error,
      errorCode: code,
      success: false,
    },
    { status: 400 }
  );
}

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
      const defaultBranch = repoInfo.defaultBranch;
      try {
        await getBranchHeadSha(ghToken, repoName, defaultBranch);
        await compareCommits(ghToken, repoName, defaultBranch, defaultBranch);
      } catch {
        return buildGitHubErrorResponse(
          "contents_read_missing",
          "The token can see the repository, but it cannot reliably read branch contents. For a fine-grained PAT, keep Contents set to Read and write for this repository."
        );
      }

      if (!repoInfo.canPush) {
        return buildGitHubErrorResponse(
          "contents_write_missing",
          "The token can read this repository, but it does not have push access. For a fine-grained PAT, choose this repository and grant Contents: Read and write."
        );
      }
      const { error: branchErr } = await supabase
        .from("system_settings")
        .upsert(
          { key: "github_default_branch", value: defaultBranch },
          { onConflict: "key" }
        );
      if (branchErr) {
        return NextResponse.json({ error: branchErr.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        defaultBranch,
        diagnosisCode: "core_access_ok",
        warningCode: "workflow_write_recommended",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      const status = extractGitHubStatus(message);
      if (status === 401 || /bad credentials/i.test(message)) {
        return buildGitHubErrorResponse(
          "bad_credentials",
          "GitHub rejected this token. Make sure you copied the full token correctly and that it has not expired or been revoked."
        );
      }
      if (status === 404) {
        return buildGitHubErrorResponse(
          "repo_not_found_or_not_selected",
          "GitHub could not find this repository through the token. Double-check owner/repo and, for a fine-grained PAT, make sure this repository is included under Repository access."
        );
      }
      if (
        status === 403 ||
        /resource not accessible by personal access token/i.test(message) ||
        /resource not accessible/i.test(message)
      ) {
        return buildGitHubErrorResponse(
          "repo_pending_approval_or_denied",
          "This token still cannot access the repository. For organization repositories, the token may still be pending admin approval. Otherwise, re-check Repository access and the required permissions."
        );
      }
      return NextResponse.json(
        {
          error: message,
          errorCode: "unknown",
          success: false,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
