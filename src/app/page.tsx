import { redirect } from "next/navigation";
import { getSetupStatus } from "@/lib/setup/status";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const setupStatus = await getSetupStatus();
  if (setupStatus.needsSetup) {
    redirect("/setup");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  redirect("/dashboard");
}
