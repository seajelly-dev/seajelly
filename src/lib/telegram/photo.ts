import { getBotForAgent } from "./bot";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB (Telegram Bot API limit)

export interface TelegramFile {
  base64: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
}

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
]);

const MIME_FROM_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav",
  txt: "text/plain", csv: "text/csv", json: "application/json",
  md: "text/markdown", html: "text/html", xml: "text/xml",
};

function guessMime(filePath: string, hintMime?: string | null): string {
  if (hintMime && hintMime !== "application/octet-stream") return hintMime;
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return MIME_FROM_EXT[ext] || "application/octet-stream";
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json";
}

export async function downloadTelegramFile(
  agentId: string,
  fileId: string,
  hintMime?: string | null,
  hintFileName?: string | null,
): Promise<TelegramFile | null> {
  try {
    const bot = await getBotForAgent(agentId);
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;

    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) return null;

    const mimeType = guessMime(file.file_path, hintMime);
    const fileName = hintFileName || file.file_path.split("/").pop() || null;

    return {
      base64: buffer.toString("base64"),
      mimeType,
      fileName,
      sizeBytes: buffer.length,
    };
  } catch (err) {
    console.warn("Failed to download Telegram file:", err);
    return null;
  }
}

/** @deprecated Use downloadTelegramFile instead */
export async function downloadTelegramPhoto(
  agentId: string,
  fileId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const result = await downloadTelegramFile(agentId, fileId, "image/jpeg");
  return result ? { base64: result.base64, mimeType: result.mimeType } : null;
}
