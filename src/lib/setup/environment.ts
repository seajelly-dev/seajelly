export type SetupEnvironmentIssueCode =
  | "missing"
  | "invalid_url"
  | "must_be_https"
  | "must_be_origin"
  | "invalid_encryption_key";

export interface SetupEnvironmentIssue {
  key: string;
  code: SetupEnvironmentIssueCode;
  message: string;
}

function validateOriginLikeUrl(
  key: string,
  rawValue: string | undefined,
  issues: SetupEnvironmentIssue[]
) {
  const value = rawValue?.trim();
  if (!value) {
    issues.push({
      key,
      code: "missing",
      message: `${key} is required`,
    });
    return;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({
      key,
      code: "invalid_url",
      message: `${key} must be a full URL like https://example.com`,
    });
    return;
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    issues.push({
      key,
      code: "must_be_origin",
      message: `${key} must be an origin only, without any path, query, or hash`,
    });
    return;
  }

  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (url.protocol !== "https:" && !isLocalhost) {
    issues.push({
      key,
      code: "must_be_https",
      message: `${key} must start with https:// in deployed environments`,
    });
  }
}

function validateEncryptionKey(issues: SetupEnvironmentIssue[]) {
  const value = process.env.ENCRYPTION_KEY?.trim();
  if (!value) {
    issues.push({
      key: "ENCRYPTION_KEY",
      code: "missing",
      message: "ENCRYPTION_KEY is required",
    });
    return;
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    issues.push({
      key: "ENCRYPTION_KEY",
      code: "invalid_encryption_key",
      message:
        "ENCRYPTION_KEY must be a 32-byte base64 string (openssl rand -base64 32)",
    });
  }
}

function validateRequiredEnv(key: string, issues: SetupEnvironmentIssue[]) {
  if (!process.env[key]?.trim()) {
    issues.push({
      key,
      code: "missing",
      message: `${key} is required`,
    });
  }
}

export function getSetupEnvironmentIssues(): SetupEnvironmentIssue[] {
  const issues: SetupEnvironmentIssue[] = [];

  validateOriginLikeUrl(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    issues
  );
  validateRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", issues);
  validateRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", issues);
  validateOriginLikeUrl(
    "NEXT_PUBLIC_APP_URL",
    process.env.NEXT_PUBLIC_APP_URL,
    issues
  );
  validateEncryptionKey(issues);
  validateRequiredEnv("CRON_SECRET", issues);

  return issues;
}
