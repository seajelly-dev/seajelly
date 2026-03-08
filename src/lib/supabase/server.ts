import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * SSR client with user session (anon key + cookies).
 * Subject to RLS — use for auth checks and user-scoped queries.
 */
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

/**
 * Admin client with service role key — bypasses RLS entirely.
 * Use in dashboard server components (already behind auth middleware).
 * Tries env var first, falls back to encrypted value in secrets table.
 */
export async function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  const { decrypt } = await import("@/lib/crypto/encrypt");

  const anonClient = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [], setAll() {} },
  });

  const { data } = await anonClient
    .from("secrets")
    .select("encrypted_value")
    .eq("key_name", "SUPABASE_SERVICE_ROLE_KEY")
    .single();

  if (!data?.encrypted_value) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY not found in env or secrets table"
    );
  }

  return createSupabaseClient(url, decrypt(data.encrypted_value));
}

/** @deprecated Use createAdminClient instead */
export const createServiceClient = createAdminClient;

/**
 * Verify the current request is from a logged-in admin.
 * Throws "Unauthorized" (no session) or "Forbidden" (not admin).
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const db = await createAdminClient();
  const { data } = await db
    .from("admins")
    .select("id")
    .eq("auth_uid", user.id)
    .single();
  if (!data) throw new Error("Forbidden");
  return user;
}

/**
 * Build a JSON error response from a requireAdmin() rejection.
 * "Unauthorized" → 401, "Forbidden" → 403.
 */
export function authErrorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : "Unauthorized";
  const status = msg === "Forbidden" ? 403 : 401;
  return NextResponse.json({ error: msg }, { status });
}
