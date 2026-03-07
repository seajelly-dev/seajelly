import { getBotForAgent } from "./bot";

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB

export async function downloadTelegramPhoto(
  agentId: string,
  fileId: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const bot = await getBotForAgent(agentId);
    const file = await bot.api.getFile(fileId);

    if (!file.file_path) return null;

    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_PHOTO_SIZE) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_PHOTO_SIZE) return null;

    const ext = file.file_path.split(".").pop()?.toLowerCase() || "jpg";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };

    return {
      base64: buffer.toString("base64"),
      mimeType: mimeMap[ext] || "image/jpeg",
    };
  } catch (err) {
    console.warn("Failed to download Telegram photo:", err);
    return null;
  }
}
