import crypto from "crypto";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { createAdminClient, createStrictServiceClient } from "@/lib/supabase/server";

export const ROOM_SUB_APP_SLUG = "room";
export const ROOM_SUB_APP_SETTING_KEYS = [
  "ROOM_TOKEN_SECRET",
  "ROOM_REALTIME_JWT_PRIVATE_KEY",
  "ROOM_REALTIME_JWT_KID",
] as const;

export type RoomSubAppSettingKey = (typeof ROOM_SUB_APP_SETTING_KEYS)[number];

export interface RoomSubAppConfig {
  ROOM_TOKEN_SECRET: string;
  ROOM_REALTIME_JWT_PRIVATE_KEY: string;
  ROOM_REALTIME_JWT_KID: string;
}

export interface RoomSubAppConfigStatus {
  complete: boolean;
  configuredKeys: RoomSubAppSettingKey[];
  missingKeys: RoomSubAppSettingKey[];
  invalidKeys: RoomSubAppSettingKey[];
  publicKeyPem: string | null;
  roomRealtimeJwtKid: string | null;
  supabaseImportJwk: string | null;
  kidIsUuid: boolean;
}

interface SubAppSettingRow {
  setting_key: string;
  encrypted_value: string;
}

const ROOM_CONFIG_CACHE_TTL_MS = 30_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let roomConfigCache:
  | {
      expiresAt: number;
      value: RoomSubAppConfig;
    }
  | null = null;

export class SubAppConfigError extends Error {
  constructor(
    public readonly subAppSlug: string,
    public readonly missingKeys: string[],
  ) {
    super(
      `${subAppSlug} sub-app configuration is incomplete: ${missingKeys.join(", ")}`,
    );
    this.name = "SubAppConfigError";
  }
}

function normalizeRoomSettingKey(value: string): RoomSubAppSettingKey | null {
  return ROOM_SUB_APP_SETTING_KEYS.includes(value as RoomSubAppSettingKey)
    ? (value as RoomSubAppSettingKey)
    : null;
}

function isUuid(value: string) {
  return UUID_RE.test(value.trim());
}

function derivePublicKeyPem(privateKeyPem: string) {
  return crypto
    .createPublicKey(privateKeyPem.replace(/\\n/g, "\n"))
    .export({ format: "pem", type: "spki" })
    .toString();
}

function deriveSupabaseImportJwk(privateKeyPem: string, kid: string) {
  const jwk = crypto
    .createPrivateKey(privateKeyPem.replace(/\\n/g, "\n"))
    .export({ format: "jwk" }) as JsonWebKey;
  return JSON.stringify(
    {
      ...jwk,
      alg: "ES256",
      kid,
    },
    null,
    2,
  );
}

function parseRoomConfig(rows: SubAppSettingRow[]) {
  const partial: Partial<RoomSubAppConfig> = {};

  for (const row of rows) {
    const key = normalizeRoomSettingKey(row.setting_key);
    if (!key) continue;
    partial[key] = decrypt(row.encrypted_value);
  }

  const configuredKeys = ROOM_SUB_APP_SETTING_KEYS.filter((key) => {
    const value = partial[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  const missingKeys = ROOM_SUB_APP_SETTING_KEYS.filter(
    (key) => !configuredKeys.includes(key),
  );

  return {
    partial,
    configuredKeys,
    missingKeys,
  };
}

async function loadRoomSettingRows() {
  const db = createStrictServiceClient();
  const { data, error } = await db
    .from("sub_app_settings")
    .select("setting_key, encrypted_value")
    .eq("sub_app_slug", ROOM_SUB_APP_SLUG)
    .in("setting_key", [...ROOM_SUB_APP_SETTING_KEYS]);

  if (error) {
    throw new Error(`Failed to load room sub-app settings: ${error.message}`);
  }

  return (data ?? []) as SubAppSettingRow[];
}

export function invalidateRoomSubAppConfigCache() {
  roomConfigCache = null;
}

export async function getRoomSubAppConfig(): Promise<RoomSubAppConfig> {
  if (roomConfigCache && roomConfigCache.expiresAt > Date.now()) {
    return roomConfigCache.value;
  }

  const rows = await loadRoomSettingRows();
  const { partial, missingKeys } = parseRoomConfig(rows);

  if (missingKeys.length > 0) {
    throw new SubAppConfigError(ROOM_SUB_APP_SLUG, missingKeys);
  }

  const value = partial as RoomSubAppConfig;
  roomConfigCache = {
    expiresAt: Date.now() + ROOM_CONFIG_CACHE_TTL_MS,
    value,
  };
  return value;
}

export async function assertRoomSubAppConfigured() {
  await getRoomSubAppConfig();
}

export async function getRoomSubAppConfigStatus() {
  const db = await createAdminClient();
  const { data, error } = await db
    .from("sub_app_settings")
    .select("setting_key, encrypted_value")
    .eq("sub_app_slug", ROOM_SUB_APP_SLUG)
    .in("setting_key", [...ROOM_SUB_APP_SETTING_KEYS]);

  if (error) {
    throw new Error(`Failed to load room sub-app settings: ${error.message}`);
  }

  const rows = (data ?? []) as SubAppSettingRow[];
  const { partial, configuredKeys, missingKeys } = parseRoomConfig(rows);
  const privateKey = partial.ROOM_REALTIME_JWT_PRIVATE_KEY;
  const kid = partial.ROOM_REALTIME_JWT_KID;
  const kidIsUuid = kid ? isUuid(kid) : false;
  const invalidKeys: RoomSubAppSettingKey[] = kid && !kidIsUuid ? ["ROOM_REALTIME_JWT_KID"] : [];

  return {
    complete: missingKeys.length === 0 && invalidKeys.length === 0,
    configuredKeys,
    missingKeys,
    invalidKeys,
    publicKeyPem: privateKey ? derivePublicKeyPem(privateKey) : null,
    roomRealtimeJwtKid: kid ?? null,
    supabaseImportJwk:
      privateKey && kid && kidIsUuid ? deriveSupabaseImportJwk(privateKey, kid) : null,
    kidIsUuid,
  } satisfies RoomSubAppConfigStatus;
}

export async function saveRoomSubAppConfig(settings: Partial<RoomSubAppConfig>) {
  const nextKid = settings.ROOM_REALTIME_JWT_KID?.trim();
  if (nextKid && !isUuid(nextKid)) {
    throw new Error(
      "ROOM_REALTIME_JWT_KID must be a UUID, for example: 550e8400-e29b-41d4-a716-446655440000",
    );
  }

  const payload = Object.entries(settings)
    .map(([settingKey, rawValue]) => {
      const normalizedKey = normalizeRoomSettingKey(settingKey);
      const trimmedValue = rawValue?.trim();
      if (!normalizedKey || !trimmedValue) {
        return null;
      }

      return {
        sub_app_slug: ROOM_SUB_APP_SLUG,
        setting_key: normalizedKey,
        encrypted_value: encrypt(trimmedValue),
      };
    })
    .filter(Boolean) as {
    sub_app_slug: string;
    setting_key: RoomSubAppSettingKey;
    encrypted_value: string;
  }[];

  if (payload.length === 0) {
    throw new Error("No room sub-app settings were provided");
  }

  const db = await createAdminClient();
  const { error } = await db.from("sub_app_settings").upsert(payload, {
    onConflict: "sub_app_slug,setting_key",
  });

  if (error) {
    throw new Error(`Failed to save room sub-app settings: ${error.message}`);
  }

  invalidateRoomSubAppConfigCache();
  return getRoomSubAppConfigStatus();
}

export function generateRoomSubAppConfigBundle() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: {
      format: "pem",
      type: "pkcs8",
    },
    publicKeyEncoding: {
      format: "pem",
      type: "spki",
    },
  });

  return {
    ROOM_TOKEN_SECRET: crypto.randomBytes(32).toString("base64url"),
    ROOM_REALTIME_JWT_PRIVATE_KEY: privateKey,
    ROOM_REALTIME_JWT_KID: crypto.randomUUID(),
    publicKeyPem: publicKey,
  };
}

export async function generateAndStoreRoomSubAppConfig() {
  const generated = generateRoomSubAppConfigBundle();

  const status = await saveRoomSubAppConfig({
    ROOM_TOKEN_SECRET: generated.ROOM_TOKEN_SECRET,
    ROOM_REALTIME_JWT_PRIVATE_KEY: generated.ROOM_REALTIME_JWT_PRIVATE_KEY,
    ROOM_REALTIME_JWT_KID: generated.ROOM_REALTIME_JWT_KID,
  });

  return {
    ...status,
    publicKeyPem: generated.publicKeyPem,
    roomRealtimeJwtKid: generated.ROOM_REALTIME_JWT_KID,
  };
}

export function isSubAppConfigError(error: unknown): error is SubAppConfigError {
  return error instanceof SubAppConfigError;
}
