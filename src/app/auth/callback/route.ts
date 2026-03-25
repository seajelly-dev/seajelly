import { NextResponse } from "next/server";
import { resolveSafeSameOriginUrl } from "@/lib/security/navigation";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(
        resolveSafeSameOriginUrl(next, origin, "/dashboard")
      );
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
