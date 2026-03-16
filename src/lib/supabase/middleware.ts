import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  LOGIN_GATE_COOKIE,
  LOGIN_GATE_QUERY_PARAM,
  sha256Hex,
} from "@/lib/security/login-gate";
import { readLoginGateSettings } from "@/lib/security/login-gate-store";

function setGateCookie(res: NextResponse, hash: string) {
  res.cookies.set(LOGIN_GATE_COOKIE, hash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function renderGateDeniedPage(pathname: string) {
  const safePath = pathname.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Security URL Required</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7fb;
        --card: #ffffff;
        --border: #e6e8ef;
        --text: #171a21;
        --muted: #5f6877;
        --danger: #c4352a;
        --danger-bg: #fff2ef;
        --accent: #0f62fe;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(15, 98, 254, 0.08), transparent 32%),
          linear-gradient(180deg, #fbfcff 0%, var(--bg) 100%);
        color: var(--text);
      }
      .card {
        width: min(680px, 100%);
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--card);
        box-shadow: 0 20px 60px rgba(16, 24, 40, 0.08);
        padding: 28px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 12px;
        background: var(--danger-bg);
        color: var(--danger);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.05;
      }
      p {
        margin: 0;
        line-height: 1.7;
        color: var(--muted);
        font-size: 15px;
      }
      .stack {
        display: grid;
        gap: 14px;
      }
      .panel {
        margin-top: 22px;
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        background: #fbfcfe;
      }
      .path {
        margin-top: 14px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        color: var(--text);
        background: #f2f4f8;
        border-radius: 12px;
        padding: 10px 12px;
        overflow-wrap: anywhere;
      }
      ol {
        margin: 14px 0 0;
        padding-left: 18px;
        color: var(--muted);
      }
      li + li {
        margin-top: 8px;
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="badge">Security URL Required</span>
      <div class="stack">
        <h1>Access blocked by the security login gate.</h1>
        <p>
          The page you tried to open requires the correct SEAJelly security URL first.
          This is not a normal 404.
        </p>
        <p>
          你当前访问的是受安全登录地址保护的页面。你没有使用正确的安全网址，
          所以系统拒绝了这次访问。这不是普通的 404。
        </p>
      </div>

      <section class="panel">
        <p><strong>Blocked path</strong></p>
        <div class="path">${safePath}</div>
        <ol>
          <li>Open the saved security login URL in this browser first.</li>
          <li>If you already opened it before, check whether the browser cookies were cleared.</li>
          <li>If you lost the security URL, ask an admin to generate or rotate it again from Dashboard → Settings.</li>
        </ol>
      </section>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonGateDeniedResponse() {
  return NextResponse.json(
    {
      error: "Security URL required",
      code: "login_gate_required",
      message:
        "Open the saved security login URL first, or ask an admin to rotate it again.",
    },
    { status: 403 }
  );
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
        ? cookieHash === gate.hash || providedHash === gate.hash
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
      return jsonGateDeniedResponse();
    }
    return renderGateDeniedPage(pathname);
  }

  const publicPaths = [
    "/setup",
    "/login",
    "/preview",
    "/voice/live",
    "/voice/asr",
    "/app",
    "/api/app",
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
