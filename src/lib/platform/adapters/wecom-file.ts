import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { resolveWeComCredentials } from "./wecom";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(agentId: string): Promise<string> {
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const creds = await resolveWeComCredentials(agentId);
  const resp = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${creds.corpId}&corpsecret=${creds.corpSecret}`,
  );
  const data = await resp.json();
  if (data.errcode !== 0) throw new Error(`WeCom token error: ${data.errmsg}`);

  const token = data.access_token as string;
  tokenCache.set(agentId, { token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 });
  return token;
}

export class WeComFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    try {
      const token = await getAccessToken(agentId);
      const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${fileRef}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn("WeCom file download failed:", res.status, res.statusText);
        return null;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json") || contentType.includes("text/plain")) {
        const body = await res.text();
        console.warn("WeCom file download returned non-binary:", body.slice(0, 200));
        return null;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) return null;

      const resolvedMime = hintMime?.split(";")[0].trim() || null;
      return {
        base64: buffer.toString("base64"),
        mimeType: guessMime(hintName || fileRef, resolvedMime),
        fileName: hintName || null,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download WeCom file:", err);
      return null;
    }
  }
}
