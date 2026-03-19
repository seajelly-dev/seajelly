import packageJson from "../../package.json";

export interface RuntimeVersionInfo {
  packageVersion: string;
  releaseTag: string;
  commitSha: string;
}

export function normalizeReleaseTag(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "v0.0.0";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function getRuntimeVersionInfo(): RuntimeVersionInfo {
  const packageVersion =
    typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "0.0.0";

  return {
    packageVersion,
    releaseTag: normalizeReleaseTag(packageVersion),
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "",
  };
}
