import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime, detectImageMimeFromBuffer } from "../file-utils";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

// Feishu's message resource API supports files up to 100 MB.
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getTenantAccessToken(agentId: string): Promise<string> {
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: rows } = await supabase
    .from("agent_credentials")
    .select("credential_type, encrypted_value")
    .eq("agent_id", agentId)
    .eq("platform", "feishu");

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    map[r.credential_type] = decrypt(r.encrypted_value);
  }
  if (!map.app_id || !map.app_secret) {
    throw new Error(`Missing Feishu credentials for agent ${agentId}`);
  }

  const resp = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: map.app_id, app_secret: map.app_secret }),
    },
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Feishu token error: ${data.msg}`);

  const token = data.tenant_access_token as string;
  tokenCache.set(agentId, { token, expiresAt: Date.now() + (data.expire - 300) * 1000 });
  return token;
}

export class FeishuFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    try {
      const token = await getTenantAccessToken(agentId);

      // fileRef format: "message_id|file_key|type" (from webhook) or legacy "image_key"
      const parts = fileRef.split("|");
      let url: string;
      if (parts.length >= 3) {
        const [messageId, fileKey, resType] = parts;
        url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${resType}`;
      } else {
        url = `https://open.feishu.cn/open-apis/im/v1/images/${fileRef}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn("Feishu file download failed:", res.status, res.statusText, url);
        return null;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const errBody = await res.text();
        console.warn("Feishu file download returned JSON (likely error):", errBody);
        return null;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
        console.warn(`[feishu-file] file too large: ${contentLength} bytes`);
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) {
        console.warn(`[feishu-file] buffer too large: ${buffer.length} bytes`);
        return null;
      }

      const resolvedHeaderMime = contentType.split(";")[0].trim() || null;
      const resolvedHintMime = hintMime?.split(";")[0].trim() || null;
      const fileKey = parts.length >= 3 ? parts[1] : fileRef;
      let finalMime = guessMime(
        hintName || fileKey,
        resolvedHeaderMime && resolvedHeaderMime !== "application/octet-stream"
          ? resolvedHeaderMime
          : resolvedHintMime
      );
      const detectedImageMime = detectImageMimeFromBuffer(buffer);
      if (detectedImageMime && finalMime !== detectedImageMime) {
        console.log(
          `[feishu-file] mime corrected by magic bytes: ${finalMime} -> ${detectedImageMime} (header=${resolvedHeaderMime ?? "n/a"}, hint=${resolvedHintMime ?? "n/a"})`
        );
        finalMime = detectedImageMime;
      }
      console.log(
        `[feishu-file] success: size=${buffer.length} mime=${finalMime} header=${resolvedHeaderMime ?? "n/a"} hint=${resolvedHintMime ?? "n/a"}`
      );
      return {
        base64: buffer.toString("base64"),
        mimeType: finalMime,
        fileName: hintName || null,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download Feishu file:", err);
      return null;
    }
  }
}
