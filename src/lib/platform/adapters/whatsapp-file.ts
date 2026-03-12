import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { resolveWhatsAppCredentials } from "./whatsapp";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const GRAPH_API = "https://graph.facebook.com/v22.0";

export class WhatsAppFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    try {
      const creds = await resolveWhatsAppCredentials(agentId);
      console.log(`WhatsApp download: fileRef=${fileRef} hintMime=${hintMime} hintName=${hintName}`);

      const metaResp = await fetch(`${GRAPH_API}/${fileRef}`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      const meta = await metaResp.json();
      if (!meta.url) {
        console.warn("WhatsApp media meta missing url:", JSON.stringify(meta).substring(0, 300));
        return null;
      }
      console.log(`WhatsApp download: meta url=${meta.url?.substring(0, 80)}... mime_type=${meta.mime_type}`);

      const dlResp = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!dlResp.ok) {
        console.warn("WhatsApp file download failed:", dlResp.status, dlResp.statusText);
        return null;
      }

      const contentLength = dlResp.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

      const buffer = Buffer.from(await dlResp.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) return null;

      const serverMime = meta.mime_type || hintMime || null;
      const resolvedMime = serverMime?.split(";")[0].trim() || null;
      const fileName = hintName || meta.file_name || null;
      const finalMime = guessMime(fileName || fileRef, resolvedMime);
      console.log(`WhatsApp download: ok size=${buffer.length} serverMime=${serverMime} resolvedMime=${resolvedMime} finalMime=${finalMime} fileName=${fileName}`);

      return {
        base64: buffer.toString("base64"),
        mimeType: finalMime,
        fileName,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download WhatsApp file:", err);
      return null;
    }
  }
}
