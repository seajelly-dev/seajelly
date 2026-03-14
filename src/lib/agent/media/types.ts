import type { ModelMessage } from "ai";
import type { PlatformFile } from "@/lib/platform/types";
import type { StagedFile } from "@/lib/jellybox/storage";

export interface ResolvedInboundFile extends PlatformFile {
  detectedImageMime: string | null;
  effectiveImageMime: string;
}

export interface MediaMessageBuildResult {
  userMessages: ModelMessage[];
  fileHandled: boolean;
  userWarning: string | null;
  imageBase64ForMediaSearch: string | null;
  imageMimeForMediaSearch: string | null;
  imageUrlForMediaSearch: string | null;
}

export interface DownloadInboundFileParams {
  agentId: string;
  platform: string;
  fileId: string;
  fileMime?: string | null;
  fileName?: string | null;
  logger?: (message: string) => void;
}

export interface BuildInboundUserMessagesParams {
  stagedFile: StagedFile | null;
  hasFileInput: boolean;
  messageText: string;
  logger?: (message: string) => void;
}
