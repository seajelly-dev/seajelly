import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — ignore
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  const { decrypt } = await import("@/lib/crypto/encrypt");
  const { createClient } = await import("@supabase/supabase-js");

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );

  const { data } = await supabase
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", "SUPABASE_SERVICE_ROLE_KEY")
    .single();

  if (!data?.encrypted_value) {
    throw new Error("Supabase Service Role Key not configured");
  }

  const serviceRoleKey = decrypt(data.encrypted_value);

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);
}
