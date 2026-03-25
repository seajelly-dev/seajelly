import type { PlatformFile, PlatformFileDownloader } from "../types";

/**
 * iLink Bot media files are encrypted with AES-128-ECB and stored on WeChat CDN.
 * Downloading requires the CDN encrypt_query_param and aes_key from the original
 * message item_list, which are not forwarded through the bridge webhook payload
 * in the current implementation.
 *
 * This is a placeholder that can be extended once CDN download is routed through
 * the Edge Gateway bridge.
 */
export class WeixinFileDownloader implements PlatformFileDownloader {
  async download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null> {
    void agentId;
    void fileRef;
    void hintMime;
    void hintName;
    return null;
  }
}
