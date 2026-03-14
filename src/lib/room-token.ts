import crypto from "crypto";
import { getRoomSubAppConfig } from "@/lib/sub-app-settings";

export interface RoomTokenPayload {
  /** room id */
  r: string;
  /** channel id (nullable for web-only guests) */
  c: string | null;
  /** platform */
  p: string;
  /** display name */
  n: string;
  /** is owner */
  o: boolean;
  /** issued at (unix seconds) */
  iat: number;
}

async function getSecret() {
  const config = await getRoomSubAppConfig();
  return config.ROOM_TOKEN_SECRET;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

export async function signRoomToken(payload: Omit<RoomTokenPayload, "iat">) {
  const full: RoomTokenPayload = { ...payload, iat: Math.floor(Date.now() / 1000) };
  const json = JSON.stringify(full);
  const data = base64UrlEncode(Buffer.from(json, "utf8"));
  const sig = crypto
    .createHmac("sha256", await getSecret())
    .update(data)
    .digest();
  return `${data}.${base64UrlEncode(sig)}`;
}

export async function verifyRoomToken(token: string): Promise<RoomTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  try {
    const secret = await getSecret();
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest();
    const actual = base64UrlDecode(sig);
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return null;
    }
    const json = base64UrlDecode(data).toString("utf8");
    const payload = JSON.parse(json) as RoomTokenPayload;
    const maxAge = 7 * 24 * 3600;
    if (Math.floor(Date.now() / 1000) - payload.iat > maxAge) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function buildRoomUrl(
  roomId: string,
  channelId: string | null,
  platform: string,
  displayName: string,
  isOwner: boolean
): Promise<string> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");
  const token = await signRoomToken({
    r: roomId,
    c: channelId,
    p: platform,
    n: displayName,
    o: isOwner,
  });
  return `${baseUrl}/app/room/${roomId}?t=${token}`;
}
