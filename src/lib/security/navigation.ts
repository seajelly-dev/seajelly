const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function toPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function parseHttpUrl(
  target: string | null | undefined,
  origin: string
): URL | null {
  if (!target) return null;

  try {
    const url = new URL(target, origin);
    return HTTP_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function resolveFallbackPath(origin: string, fallback: string): string {
  const fallbackUrl = parseHttpUrl(fallback, origin);
  if (!fallbackUrl || fallbackUrl.origin !== origin) {
    return "/";
  }
  return toPath(fallbackUrl);
}

export function resolveSafeSameOriginPath(
  target: string | null | undefined,
  origin: string,
  fallback = "/"
): string {
  const fallbackPath = resolveFallbackPath(origin, fallback);
  const url = parseHttpUrl(target, origin);

  if (!url || url.origin !== origin) {
    return fallbackPath;
  }

  return toPath(url);
}

export function resolveSafeSameOriginUrl(
  target: string | null | undefined,
  origin: string,
  fallback = "/"
): string {
  return new URL(resolveSafeSameOriginPath(target, origin, fallback), origin).toString();
}

export function resolveSafeClientNavigationTarget(
  target: string | null | undefined,
  origin: string,
  fallback = "/"
): { type: "internal" | "external"; href: string } {
  const fallbackPath = resolveFallbackPath(origin, fallback);
  const url = parseHttpUrl(target, origin);

  if (!url) {
    return { type: "internal", href: fallbackPath };
  }

  if (url.origin === origin) {
    return { type: "internal", href: toPath(url) };
  }

  return { type: "external", href: url.toString() };
}
