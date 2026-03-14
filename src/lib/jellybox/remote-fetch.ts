import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAME_SUFFIXES = [".internal", ".local", ".localhost", ".localdomain"] as const;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function isPrivateIpv4Address(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = parts;

  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  if (first >= 224) return true;

  return false;
}

function isPrivateIpv6Address(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return isPrivateIpv4Address(mappedIpv4);
  }

  return false;
}

export function isPrivateIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4Address(address);
  if (family === 6) return isPrivateIpv6Address(address);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost") return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

interface SafeUrlDeps {
  lookup?: LookupAllFn;
}

interface LookupAddressResult {
  address: string;
  family: number;
}

type LookupAllFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddressResult[]>;

export async function assertSafeRemoteUrl(
  input: string,
  deps: SafeUrlDeps = {},
): Promise<URL> {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Invalid source_url");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("source_url must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("source_url must not include credentials");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("source_url points to a private or blocked host");
  }

  const lookup: LookupAllFn = deps.lookup ?? ((hostname, options) => dnsLookup(hostname, options));
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("source_url could not be resolved");
  }
  if (addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new Error("source_url resolves to a private or blocked address");
  }

  return parsed;
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("file too large");
      throw new Error(`File too large: received more than ${maxBytes} bytes`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

export interface FetchRemoteFileResult {
  body: Buffer;
  mimeType?: string;
  finalUrl: string;
}

interface FetchRemoteFileParams {
  url: string;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

interface FetchRemoteFileDeps extends SafeUrlDeps {
  fetchFn?: typeof fetch;
}

export async function fetchRemoteFile(
  params: FetchRemoteFileParams,
  deps: FetchRemoteFileDeps = {},
): Promise<FetchRemoteFileResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = params.timeoutMs ?? 15_000;
  const maxRedirects = params.maxRedirects ?? 3;
  let currentUrl = params.url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await assertSafeRemoteUrl(currentUrl, deps);
    const response = await fetchFn(safeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Remote source redirected without a location");
      }
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > params.maxBytes) {
        throw new Error(`File too large: remote content-length exceeds ${params.maxBytes} bytes`);
      }
    }

    const body = await readBodyWithLimit(response, params.maxBytes);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;

    return {
      body,
      mimeType,
      finalUrl: safeUrl.toString(),
    };
  }

  throw new Error("Too many redirects while fetching source_url");
}
