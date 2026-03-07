import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();

  let db;
  try {
    db = await createAdminClient();
  } catch {
    db = supabase;
  }

  const [admins, secrets, agents] = await Promise.all([
    db.from("admins").select("*", { count: "exact", head: true }),
    db.from("secrets").select("key_name"),
    db.from("agents").select("*", { count: "exact", head: true }),
  ]);

  const hasAdmin = (admins.count ?? 0) > 0;
  const secretKeys = (secrets.data ?? []).map((s) => s.key_name);
  const hasRequiredSecrets =
    secretKeys.includes("SUPABASE_SERVICE_ROLE_KEY") &&
    secretKeys.includes("SUPABASE_ACCESS_TOKEN") &&
    secretKeys.includes("SUPABASE_PROJECT_REF");
  const hasLLMKey = secretKeys.some((k) =>
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "DEEPSEEK_API_KEY"].includes(k)
  );
  const hasAgent = (agents.count ?? 0) > 0;

  if (!hasAdmin || !hasRequiredSecrets || !hasLLMKey || !hasAgent) {
    redirect("/setup");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  redirect("/dashboard");
}
