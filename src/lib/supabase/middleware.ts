import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  LOGIN_GATE_COOKIE,
  LOGIN_GATE_ENABLED_KEY,
  LOGIN_GATE_HASH_KEY,
  LOGIN_GATE_QUERY_PARAM,
  parseBooleanText,
  sha256Hex,
} from "@/lib/security/login-gate";

const GATE_CACHE_TTL_MS = 1_000;
let gateCache:
  | { enabled: boolean; hash: string; cachedAt: number }
  | null = null;

async function readLoginGateSettings() {
  const now = Date.now();
  if (gateCache && now - gateCache.cachedAt < GATE_CACHE_TTL_MS) {
    return gateCache;
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = new URL(`${base}/rest/v1/system_settings`);
  url.searchParams.set("select", "key,value");
  url.searchParams.set(
    "key",
    `in.(${LOGIN_GATE_ENABLED_KEY},${LOGIN_GATE_HASH_KEY})`
  );

  const res = await fetch(url.toString(), {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const fallback = { enabled: false, hash: "", cachedAt: now };
    gateCache = fallback;
    return fallback;
  }

  const rows = (await res.json()) as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  const parsed = {
    enabled: parseBooleanText(map[LOGIN_GATE_ENABLED_KEY]),
    hash: map[LOGIN_GATE_HASH_KEY] ?? "",
    cachedAt: now,
  };
  gateCache = parsed;
  return parsed;
}

function setGateCookie(res: NextResponse, hash: string) {
  res.cookies.set(LOGIN_GATE_COOKIE, hash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const shouldCheckGate =
    pathname === "/login" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/auth/login");

  let gatePassedByKey = false;
  let gateHash = "";
  let gateEnabled = false;
  let gateOk = true;
  if (shouldCheckGate) {
    const gate = await readLoginGateSettings();
    if (gate.enabled && gate.hash) {
      gateEnabled = true;
      gateHash = gate.hash;
      const cookieHash = request.cookies.get(LOGIN_GATE_COOKIE)?.value ?? "";
      const providedKey =
        request.nextUrl.searchParams.get(LOGIN_GATE_QUERY_PARAM) ??
        request.headers.get("x-login-gate-key") ??
        "";
      const providedHash = providedKey ? await sha256Hex(providedKey) : "";
      const isLoginPath = pathname === "/login";
      const isLoginApiPath = pathname.startsWith("/api/auth/login");
      gateOk = isLoginPath || isLoginApiPath
        ? providedHash === gate.hash
        : cookieHash === gate.hash || providedHash === gate.hash;
      gatePassedByKey = providedHash === gate.hash;
    }
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in users should never stay on /login
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.delete(LOGIN_GATE_QUERY_PARAM);
    const redirectRes = NextResponse.redirect(url);
    if (gatePassedByKey && gateHash) {
      setGateCookie(redirectRes, gateHash);
    }
    return redirectRes;
  }

  if (gateEnabled && !gateOk) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Security key required" }, { status: 403 });
    }
    return new NextResponse("Not Found", { status: 404 });
  }

  const publicPaths = [
    "/setup",
    "/login",
    "/preview",
    "/voice/live",
    "/voice/asr",
    "/api/auth/login",
    "/api/webhook",
    "/api/worker",
    "/api/admin/setup",
    "/api/voice/live-config",
    "/api/voice/asr-config",
    "/api/voice/temp-link",
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  if (!user && !isPublic && pathname !== "/") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectRes = NextResponse.redirect(url);
    if (gatePassedByKey && gateHash) {
      setGateCookie(redirectRes, gateHash);
    }
    return redirectRes;
  }

  if (gatePassedByKey && gateHash) {
    setGateCookie(supabaseResponse, gateHash);
  }

  return supabaseResponse;
}
