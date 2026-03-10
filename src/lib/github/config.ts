import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function getGitHubToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", "GITHUB_TOKEN")
    .single();

  if (!data?.encrypted_value) return null;
  try {
    return decrypt(data.encrypted_value);
  } catch {
    return null;
  }
}

export async function getGitHubRepo(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "github_repo")
    .single();

  return data?.value || null;
}

export async function getGitHubConfig(): Promise<{
  token: string | null;
  repo: string | null;
}> {
  const [token, repo] = await Promise.all([getGitHubToken(), getGitHubRepo()]);
  return { token, repo };
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const cleaned = repo
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const [owner, name] = cleaned.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  return { owner, name };
}
