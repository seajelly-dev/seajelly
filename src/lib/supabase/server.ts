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

function getServiceRoleConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return { url, serviceRoleKey };
}

/**
 * Strict service role client for security-sensitive server paths.
 * This intentionally does not fall back to any lower-privilege key or secrets table lookup.
 */
export function createStrictServiceClient() {
  const { url, serviceRoleKey } = getServiceRoleConfig();
  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Admin client with service role key — bypasses RLS entirely.
 * Use in dashboard server components and admin APIs.
 * This follows the deployment env as the single source of truth.
 */
export async function createAdminClient() {
  return createStrictServiceClient();
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
