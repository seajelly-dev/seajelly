import {
  LOGIN_GATE_ENABLED_KEY,
  LOGIN_GATE_HASH_KEY,
  parseBooleanText,
} from "@/lib/security/login-gate";

const GATE_CACHE_TTL_MS = 1_000;

let gateCache:
  | {
      enabled: boolean;
      hash: string;
      cachedAt: number;
    }
  | null = null;

async function fetchGateRows(apiKey: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  const url = new URL(`${base}/rest/v1/system_settings`);
  url.searchParams.set("select", "key,value");
  url.searchParams.set(
    "key",
    `in.(${LOGIN_GATE_ENABLED_KEY},${LOGIN_GATE_HASH_KEY})`
  );

  const res = await fetch(url.toString(), {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Failed to read login gate settings (${res.status}): ${await res.text()}`
    );
  }

  return (await res.json()) as Array<{ key: string; value: string }>;
}

export async function readLoginGateSettings() {
  const now = Date.now();
  if (gateCache && now - gateCache.cachedAt < GATE_CACHE_TTL_MS) {
    return gateCache;
  }

  const keys = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ].filter((value): value is string => Boolean(value));

  const errors: string[] = [];

  for (const apiKey of keys) {
    try {
      const rows = await fetchGateRows(apiKey);
      const map: Record<string, string> = {};
      for (const row of rows) map[row.key] = row.value;

      const parsed = {
        enabled: parseBooleanText(map[LOGIN_GATE_ENABLED_KEY]),
        hash: map[LOGIN_GATE_HASH_KEY] ?? "",
        cachedAt: now,
      };
      gateCache = parsed;
      return parsed;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (gateCache) {
    return gateCache;
  }

  const combined = errors.join(" | ");
  const setupIncomplete =
    /relation .*system_settings.* does not exist/i.test(combined) ||
    /Could not find the table/i.test(combined);

  if (!setupIncomplete && combined) {
    console.error("Failed to load login gate settings:", combined);
  }

  return {
    enabled: false,
    hash: "",
    cachedAt: now,
  };
}

export function clearLoginGateSettingsCache() {
  gateCache = null;
}
