import dns from "dns/promises";

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

async function resolveAllIPs(hostname: string): Promise<string[]> {
  const ips: string[] = [];
  try {
    const v4 = await dns.resolve4(hostname);
    ips.push(...v4);
  } catch {
    /* no A records */
  }
  try {
    const v6 = await dns.resolve6(hostname);
    ips.push(...v6);
  } catch {
    /* no AAAA records */
  }
  return ips;
}

/**
 * Validate a URL is safe for server-side fetching.
 * - Only HTTPS in production (HTTP allowed in dev)
 * - Resolves ALL DNS records and blocks private/reserved IPs
 */
export async function validateExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError("Invalid URL");
  }

  const isProd = process.env.NODE_ENV === "production";
  if (isProd && parsed.protocol !== "https:") {
    throw new SSRFError("Only HTTPS URLs are allowed in production");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SSRFError("Only HTTP(S) protocols are allowed");
  }

  const hostname = parsed.hostname;

  if (hostname === "localhost" || hostname === "[::1]") {
    throw new SSRFError("Localhost URLs are not allowed");
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new SSRFError("Private IP addresses are not allowed");
    }
    return;
  }

  const ips = await resolveAllIPs(hostname);
  if (ips.length === 0) {
    throw new SSRFError(`DNS resolution failed for ${hostname}`);
  }

  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      throw new SSRFError(
        `Hostname resolves to private IP (${ip})`
      );
    }
  }
}

const MAX_REDIRECTS = 5;

/**
 * Safe fetch wrapper with SSRF protection, timeout, size limits,
 * and redirect-safe validation.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit & { maxBytes?: number; timeoutMs?: number }
): Promise<Response> {
  await validateExternalUrl(url);

  const { maxBytes = 1_048_576, timeoutMs = 10_000, ...fetchInit } = init ?? {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const res = await fetch(currentUrl, {
        ...fetchInit,
        signal: controller.signal,
        redirect: "manual",
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) {
          throw new SSRFError("Redirect without Location header");
        }
        const nextUrl = new URL(location, currentUrl).toString();
        await validateExternalUrl(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxBytes) {
        throw new SSRFError(
          `Response too large (${contentLength} bytes, max ${maxBytes})`
        );
      }

      if (!res.body) return res;

      return new Response(limitedStream(res.body, maxBytes), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    throw new SSRFError(`Too many redirects (max ${MAX_REDIRECTS})`);
  } finally {
    clearTimeout(timer);
  }
}

function limitedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let received = 0;
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        reader.cancel();
        controller.error(
          new SSRFError(
            `Response body exceeded ${maxBytes} bytes (streamed)`
          )
        );
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
    },
  });
}
