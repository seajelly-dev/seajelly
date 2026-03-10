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
      if (!file.file_path) return null;

      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) return null;

      return {
        base64: buffer.toString("base64"),
        mimeType: guessMime(file.file_path, hintMime),
        fileName: hintName || file.file_path.split("/").pop() || null,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      console.warn("Failed to download Telegram file:", err);
      return null;
    }
  }
}
