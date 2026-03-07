import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();

  const [admins, secrets, agents] = await Promise.all([
    supabase.from("admins").select("*", { count: "exact", head: true }),
    supabase.from("secrets").select("key_name"),
    supabase.from("agents").select("*", { count: "exact", head: true }),
  ]);

  const hasAdmin = (admins.count ?? 0) > 0;
  const secretKeys = (secrets.data ?? []).map((s) => s.key_name);
  const hasRequiredSecrets = secretKeys.includes("SUPABASE_SERVICE_ROLE_KEY");
  const hasAgent = (agents.count ?? 0) > 0;

  if (!hasAdmin || !hasRequiredSecrets || !hasAgent) {
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
