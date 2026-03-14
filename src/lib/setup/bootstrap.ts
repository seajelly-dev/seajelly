import type { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";

export const SETUP_BOOTSTRAP_COOKIE = "seajelly_setup_bootstrap";
export const SETUP_BOOTSTRAP_COOKIE_MAX_AGE = 60 * 60 * 2;
export const SETUP_BOOTSTRAP_MISSING_CODE = "setup_bootstrap_missing";

export interface SetupBootstrapCredentials {
  access_token: string;
  project_ref: string;
}

interface CookieWriter {
  set(
    name: string,
    value: string,
    options: {
      httpOnly?: boolean;
      maxAge?: number;
      path?: string;
      sameSite?: "lax" | "strict" | "none";
      secure?: boolean;
    }
  ): void;
}

function getCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function parseBootstrapCookie(value: string | undefined): SetupBootstrapCredentials | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decrypt(value)) as Partial<SetupBootstrapCredentials>;
    const access_token = parsed.access_token?.trim() ?? "";
    const project_ref = parsed.project_ref?.trim() ?? "";
    if (!access_token || !project_ref) {
      return null;
    }
    return { access_token, project_ref };
  } catch {
    return null;
  }
}

export function resolveSetupBootstrapCredentials(
  request: NextRequest,
  body: Partial<SetupBootstrapCredentials>
): SetupBootstrapCredentials | null {
  const access_token = body.access_token?.trim() ?? "";
  const project_ref = body.project_ref?.trim() ?? "";
  if (access_token && project_ref) {
    return { access_token, project_ref };
  }

  return parseBootstrapCookie(request.cookies.get(SETUP_BOOTSTRAP_COOKIE)?.value);
}

function writeBootstrapCookie(
  cookies: CookieWriter,
  credentials: SetupBootstrapCredentials,
  maxAge: number
) {
  cookies.set(
    SETUP_BOOTSTRAP_COOKIE,
    encrypt(JSON.stringify(credentials)),
    getCookieOptions(maxAge)
  );
}

export function setSetupBootstrapCookie(
  response: NextResponse,
  credentials: SetupBootstrapCredentials
) {
  writeBootstrapCookie(response.cookies, credentials, SETUP_BOOTSTRAP_COOKIE_MAX_AGE);
}

export function clearSetupBootstrapCookie(response: NextResponse) {
  response.cookies.set(SETUP_BOOTSTRAP_COOKIE, "", getCookieOptions(0));
}
