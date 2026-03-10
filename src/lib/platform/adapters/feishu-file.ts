import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/encrypt";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

      const url = `https://open.feishu.cn/open-apis/im/v1/images/${fileRef}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn("Feishu file download failed:", res.status, res.statusText);
        return null;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        console.warn("Feishu file download returned JSON (likely error)");
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
      console.warn("Failed to download Feishu file:", err);
      return null;
    }
  }
}
