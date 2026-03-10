import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { resolveSlackCredentials } from "./slack";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;

async function fetchWithAuth(url: string, token: string): Promise<Response> {
  let current = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const res = await fetch(current, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      current = location;
      continue;
    }
    return res;
  }
  return fetch(current, { headers: { Authorization: `Bearer ${token}` } });
}

export class SlackFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    try {
      if (!fileRef.startsWith("http")) return null;

      const creds = await resolveSlackCredentials(agentId);
      const res = await fetchWithAuth(fileRef, creds.botToken);
      if (!res.ok) {
        console.warn("Slack file download failed:", res.status, res.statusText);
        return null;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        console.warn("Slack file download returned HTML (likely auth failure)");
        return null;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) return null;

      const resolvedMime = hintMime?.split(";")[0].trim() || null;
      const fileName = hintName || fileRef.split("/").pop()?.split("?")[0] || null;
      return {
        base64: buffer.toString("base64"),
        mimeType: guessMime(fileName || "", resolvedMime),
        fileName,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download Slack file:", err);
      return null;
    }
  }
}
