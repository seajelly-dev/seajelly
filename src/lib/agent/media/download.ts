import { detectImageMimeFromBuffer } from "@/lib/platform/file-utils";
import { getFileDownloader } from "@/lib/platform/sender";
import type { DownloadInboundFileParams, ResolvedInboundFile } from "./types";

export async function downloadInboundFile(
  params: DownloadInboundFileParams,
): Promise<ResolvedInboundFile | null> {
  const { agentId, platform, fileId, fileMime, fileName, logger } = params;
  const fileDownloader = getFileDownloader(platform);
  const file = await fileDownloader.download(agentId, fileId, fileMime, fileName);
  if (!file) {
    logger?.(`file download returned null: platform=${platform} fileId=${fileId} fileMime=${fileMime ?? "unknown"}`);
    return null;
  }

  let detectedImageMime: string | null = null;
  let effectiveImageMime = file.mimeType;
  if (file.mimeType.startsWith("image/")) {
    detectedImageMime = detectImageMimeFromBuffer(Buffer.from(file.base64, "base64"));
    effectiveImageMime = detectedImageMime || file.mimeType;
    if (detectedImageMime && detectedImageMime !== file.mimeType) {
      logger?.(`image mime corrected: ${file.mimeType} -> ${detectedImageMime}`);
    }
  }

  return {
    ...file,
    detectedImageMime,
    effectiveImageMime,
  };
}

