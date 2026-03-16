import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  LOGIN_GATE_COOKIE,
  sha256Hex,
} from "@/lib/security/login-gate";
import { readLoginGateSettings } from "@/lib/security/login-gate-store";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    gateKey?: string;
  };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  const gateKey = body.gateKey ?? request.headers.get("x-login-gate-key") ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const gate = await readLoginGateSettings();
  const gateEnabled = gate.enabled && !!gate.hash;
  if (gateEnabled) {
    const cookieHash = request.cookies.get(LOGIN_GATE_COOKIE)?.value ?? "";
    const providedHash = gateKey ? await sha256Hex(gateKey) : "";
    if (cookieHash !== gate.hash && providedHash !== gate.hash) {
      return NextResponse.json({ error: "Invalid security key" }, { status: 403 });
    }
  }

  const response = NextResponse.json({ success: true });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (gateEnabled) {
    response.cookies.set(LOGIN_GATE_COOKIE, gate.hash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}
