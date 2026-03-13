import type { ModelMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandT, LoopResult } from "@/lib/agent/commands/types";
import type { PlatformFile, PlatformSender } from "@/lib/platform/types";
import type { Session } from "@/types/database";

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
  resolvedFile: ResolvedInboundFile | null;
  hasFileInput: boolean;
  messageText: string;
  logger?: (message: string) => void;
}

export interface HandlePendingImageEditParams {
  resolvedFile: ResolvedInboundFile | null;
  session: Session;
  supabase: SupabaseClient;
  sender: PlatformSender;
  platformChatId: string;
  messageText: string;
  t: CommandT;
  traceId: string;
  generateImageOverride?: (params: {
    prompt: string;
    sourceImageBase64: string;
    sourceMimeType: string;
  }) => Promise<{
    imageBase64: string;
    textResponse?: string | null;
    durationMs: number;
  }>;
}

export interface ImageEditInterceptResult {
  handled: boolean;
  result?: LoopResult;
}
