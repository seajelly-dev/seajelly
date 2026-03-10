import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { resolveSlackCredentials } from "./slack";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
      const res = await fetch(fileRef, {
        headers: { Authorization: `Bearer ${creds.botToken}` },
      });
      if (!res.ok) return null;

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) return null;

      const fileName = hintName || fileRef.split("/").pop()?.split("?")[0] || null;
      return {
        base64: buffer.toString("base64"),
        mimeType: guessMime(fileName || "", hintMime),
        fileName,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download Slack file:", err);
      return null;
    }
  }
}
