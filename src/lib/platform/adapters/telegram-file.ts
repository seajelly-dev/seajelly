import type { PlatformFileDownloader, PlatformFile } from "../types";
import { guessMime } from "../file-utils";
import { getBotForAgent } from "@/lib/telegram/bot";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export class TelegramFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    try {
      const bot = await getBotForAgent(agentId);
      const file = await bot.api.getFile(fileRef);
      if (!file.file_path) {
        console.warn(`[tg-file] getFile returned no file_path: fileRef=${fileRef}`);
        return null;
      }

      const url = `https://api.telegram.org/file/bot${"*".repeat(8)}/${file.file_path}`;
      console.log(`[tg-file] downloading: path=${file.file_path} hintMime=${hintMime}`);
      const res = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`);
      if (!res.ok) {
        console.warn(`[tg-file] download HTTP ${res.status}: path=${file.file_path}`);
        return null;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
        console.warn(`[tg-file] file too large: ${contentLength} bytes`);
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) {
        console.warn(`[tg-file] buffer too large: ${buffer.length} bytes`);
        return null;
      }

      const mime = guessMime(file.file_path, hintMime);
      console.log(`[tg-file] success: size=${buffer.length} mime=${mime}`);
      return {
        base64: buffer.toString("base64"),
        mimeType: mime,
        fileName: hintName || file.file_path.split("/").pop() || null,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("[tg-file] download failed:", err);
      return null;
    }
  }
}
