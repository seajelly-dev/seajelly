import { createStrictServiceClient } from "@/lib/supabase/server";

export type GatewayRouteKind = "http_forward" | "multipart_upload" | "ws_relay" | "longpoll_bridge";
export type GatewayCapability = string;

export interface GatewayRoute {
  id: string;
  capability: GatewayCapability;
  kind: GatewayRouteKind;
  path: string;
}

export interface GatewayManifest {
  version: string;
  configVersion: string;
  publicIp: string;
  capabilities: GatewayCapability[];
  routes: GatewayRoute[];
}

export interface GatewayConfig {
  url: string;
  secret: string;
}

export interface GatewayConnection extends GatewayConfig {
  manifest: GatewayManifest;
}

const SETTINGS_CACHE_TTL_MS = 30_000;
const MANIFEST_CACHE_TTL_MS = 30_000;

let settingsCache: { expiresAt: number; value: GatewayConfig | null } | null = null;
let manifestCache: { key: string; expiresAt: number; value: GatewayManifest } | null = null;

function normalizeGatewayBaseUrl(url: string) {
  return url.replace(/\/$/, "");
}

function mapGatewayRouteKind(kind: unknown): GatewayRouteKind {
  if (kind === "http_forward" || kind === "multipart_upload" || kind === "ws_relay" || kind === "longpoll_bridge") {
    return kind;
  }
  throw new Error(`Invalid gateway route kind: ${String(kind)}`);
}

function parseGatewayManifest(value: unknown): GatewayManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid gateway manifest payload");
  }

  const raw = value as Record<string, unknown>;
  const routes = Array.isArray(raw.routes) ? raw.routes : [];
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((item): item is string => typeof item === "string")
    : [];

  if (typeof raw.version !== "string") {
    throw new Error("Gateway manifest is missing version");
  }
  if (typeof raw.config_version !== "string") {
    throw new Error("Gateway manifest is missing config_version");
  }
  if (typeof raw.public_ip !== "string") {
    throw new Error("Gateway manifest is missing public_ip");
  }

  return {
    version: raw.version,
    configVersion: raw.config_version,
    publicIp: raw.public_ip,
    capabilities,
    routes: routes.map((route) => {
      if (!route || typeof route !== "object") {
        throw new Error("Gateway manifest contains an invalid route");
      }
      const rawRoute = route as Record<string, unknown>;
      if (
        typeof rawRoute.id !== "string" ||
        typeof rawRoute.capability !== "string" ||
        typeof rawRoute.kind !== "string" ||
        typeof rawRoute.path !== "string"
      ) {
        throw new Error("Gateway manifest route is missing required fields");
      }
      return {
        id: rawRoute.id,
        capability: rawRoute.capability,
        kind: mapGatewayRouteKind(rawRoute.kind),
        path: rawRoute.path,
      };
    }),
  };
}

async function loadGatewaySettings(forceRefresh = false): Promise<GatewayConfig | null> {
  if (!forceRefresh && settingsCache && settingsCache.expiresAt > Date.now()) {
    return settingsCache.value;
  }

  const supabase = createStrictServiceClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", ["gateway_url", "gateway_secret"]);

  if (error) {
    throw new Error(`Failed to load gateway settings: ${error.message}`);
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }

  const value = settings.gateway_url && settings.gateway_secret
    ? { url: settings.gateway_url, secret: settings.gateway_secret }
    : null;

  settingsCache = {
    value,
    expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
  };

  return value;
}

export async function fetchGatewayManifest(
  config: GatewayConfig,
  fetchFn: typeof fetch = fetch,
): Promise<GatewayManifest> {
  const response = await fetchFn(`${normalizeGatewayBaseUrl(config.url)}/manifest`, {
    headers: { "X-Gateway-Secret": config.secret },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway manifest request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return parseGatewayManifest(payload);
}

export async function loadGatewayManifest(
  config: GatewayConfig,
  options?: { fetchFn?: typeof fetch; forceRefresh?: boolean },
): Promise<GatewayManifest> {
  const cacheKey = `${normalizeGatewayBaseUrl(config.url)}::${config.secret}`;
  if (!options?.forceRefresh && manifestCache && manifestCache.key === cacheKey && manifestCache.expiresAt > Date.now()) {
    return manifestCache.value;
  }

  const manifest = await fetchGatewayManifest(config, options?.fetchFn);
  manifestCache = {
    key: cacheKey,
    value: manifest,
    expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
  };

  return manifest;
}

export async function getGatewayConnection(): Promise<GatewayConnection | null> {
  const config = await loadGatewaySettings();
  if (!config) return null;

  return {
    ...config,
    manifest: await loadGatewayManifest(config),
  };
}

export function findGatewayCapability(
  manifest: GatewayManifest,
  capability: GatewayCapability,
): GatewayRoute | null {
  return manifest.routes.find((route) => route.capability === capability) ?? null;
}

export async function getGatewayCapability(capability: GatewayCapability): Promise<{
  connection: GatewayConnection;
  route: GatewayRoute;
}> {
  const connection = await getGatewayConnection();
  if (!connection) {
    throw new Error("Edge Gateway not configured");
  }

  const route = findGatewayCapability(connection.manifest, capability);
  if (!route) {
    throw new Error(`Gateway capability missing: ${capability}`);
  }

  return { connection, route };
}

export function buildGatewayRouteUrl(
  baseUrl: string,
  routePath: string,
  options?: {
    transport?: "http" | "ws";
    secret?: string;
    includeSecretQuery?: boolean;
  },
): string {
  const base = normalizeGatewayBaseUrl(baseUrl);
  const url = new URL(routePath, `${base}/`);
  if (options?.transport === "ws") {
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  }
  if (options?.includeSecretQuery && options.secret) {
    url.searchParams.set("secret", options.secret);
  }
  return url.toString();
}

export async function postGatewayRoute(
  capability: GatewayCapability,
  body: unknown,
  options?: {
    fetchFn?: typeof fetch;
    headers?: HeadersInit;
    signal?: AbortSignal;
    connection?: GatewayConnection;
  },
): Promise<Response> {
  const resolved = options?.connection
    ? { connection: options.connection, route: findGatewayCapability(options.connection.manifest, capability) }
    : await getGatewayCapability(capability);

  if (!resolved.route) {
    throw new Error(`Gateway capability missing: ${capability}`);
  }

  const fetchFn = options?.fetchFn ?? fetch;
  return fetchFn(buildGatewayRouteUrl(resolved.connection.url, resolved.route.path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Secret": resolved.connection.secret,
      ...(options?.headers || {}),
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export function __resetGatewayClientCacheForTests() {
  settingsCache = null;
  manifestCache = null;
}
