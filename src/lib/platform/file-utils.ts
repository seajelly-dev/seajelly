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

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json";
}

export function guessMime(filePath: string, hintMime?: string | null): string {
  if (hintMime && hintMime !== "application/octet-stream") return hintMime;
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return MIME_FROM_EXT[ext] || "application/octet-stream";
}
