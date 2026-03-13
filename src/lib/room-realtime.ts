import crypto from "crypto";
import type { RoomTokenPayload } from "@/lib/room-token";

const ROOM_REALTIME_TTL_SECONDS = 10 * 60;

let cachedPrivateKey: crypto.KeyObject | null = null;

function base64UrlEncode(value: Buffer | string) {
  return Buffer.isBuffer(value)
    ? value.toString("base64url")
    : Buffer.from(value, "utf8").toString("base64url");
}

function getProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) {
    return process.env.SUPABASE_PROJECT_REF;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  }

  const hostname = new URL(url).hostname;
  const [projectRef] = hostname.split(".");
  if (!projectRef) {
    throw new Error("Failed to derive Supabase project ref");
  }

  return projectRef;
}

function getRealtimeSigningKey() {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const rawPrivateKey = process.env.ROOM_REALTIME_JWT_PRIVATE_KEY;
  if (!rawPrivateKey) {
    throw new Error("ROOM_REALTIME_JWT_PRIVATE_KEY is required");
  }

  cachedPrivateKey = crypto.createPrivateKey(rawPrivateKey.replace(/\\n/g, "\n"));
  return cachedPrivateKey;
}

function signEs256Jwt(payload: Record<string, unknown>) {
  const kid = process.env.ROOM_REALTIME_JWT_KID;
  if (!kid) {
    throw new Error("ROOM_REALTIME_JWT_KID is required");
  }

  const header = {
    alg: "ES256",
    kid,
    typ: "JWT",
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "utf8"), {
    key: getRealtimeSigningKey(),
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function getRoomRealtimeTopic(roomId: string) {
  return `room:${roomId}`;
}

export function createRoomRealtimeSession(token: RoomTokenPayload) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ROOM_REALTIME_TTL_SECONDS;
  const roomRole = token.o ? "owner" : "guest";

  const payload = {
    aud: "authenticated",
    exp: expiresAt,
    iat: issuedAt,
    iss: `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1`,
    jti: crypto.randomUUID(),
    ref: getProjectRef(),
    role: "authenticated",
    room_id: token.r,
    room_role: roomRole,
    platform: token.p,
    display_name: token.n,
    session_id: crypto.randomUUID(),
    sub: crypto.randomUUID(),
  };

  return {
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    realtimeJwt: signEs256Jwt(payload),
    topic: getRoomRealtimeTopic(token.r),
  };
}
