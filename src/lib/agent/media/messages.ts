import { isImageMime, isTextMime } from "@/lib/platform/file-utils";
import type { BuildInboundUserMessagesParams, MediaMessageBuildResult } from "./types";

export function buildInboundUserMessages(
  params: BuildInboundUserMessagesParams,
): MediaMessageBuildResult {
  const { resolvedFile, hasFileInput, messageText, logger } = params;

  if (resolvedFile) {
    const mime = resolvedFile.mimeType;
    const textPrompt = messageText || "";

    if (isImageMime(mime)) {
      return {
        messagesToAppend: [
          {
            role: "user",
            content: [
              { type: "image", image: resolvedFile.base64, mediaType: resolvedFile.effectiveImageMime },
              { type: "text", text: textPrompt || "Please describe or analyze this image." },
            ],
          },
        ],
        fileHandled: true,
        warningText: null,
        imageBase64ForMediaSearch: resolvedFile.base64,
        imageMimeForMediaSearch: resolvedFile.effectiveImageMime,
      };
    }

    if (isTextMime(mime)) {
      const decoded = Buffer.from(resolvedFile.base64, "base64").toString("utf-8");
      const label = resolvedFile.fileName ? `[File: ${resolvedFile.fileName}]` : "[Text file]";
      return {
        messagesToAppend: [
          {
            role: "user",
            content: `${label}\n\`\`\`\n${decoded.slice(0, 50_000)}\n\`\`\`\n\n${textPrompt || "Please analyze this file."}`,
          },
        ],
        fileHandled: true,
        warningText: null,
        imageBase64ForMediaSearch: null,
        imageMimeForMediaSearch: null,
      };
    }

    if (mime === "application/pdf" || mime.startsWith("video/") || mime.startsWith("audio/")) {
      const defaultPrompt =
        mime === "application/pdf"
          ? "Please analyze this PDF document."
          : mime.startsWith("video/")
            ? "Please analyze this video."
            : "Please analyze this audio.";
      return {
        messagesToAppend: [
          {
            role: "user",
            content: [
              { type: "file", data: resolvedFile.base64, mediaType: mime },
              { type: "text", text: textPrompt || defaultPrompt },
            ],
          },
        ],
        fileHandled: true,
        warningText: null,
        imageBase64ForMediaSearch: null,
        imageMimeForMediaSearch: null,
      };
    }

    const label = resolvedFile.fileName
      ? `[File: ${resolvedFile.fileName}, type: ${mime}]`
      : `[File: ${mime}]`;
    return {
      messagesToAppend: [
        {
          role: "user",
          content: `${label}\n(Binary file — ${resolvedFile.sizeBytes} bytes)\n\n${textPrompt || "I sent you a file. What can you help me with?"}`,
        },
      ],
      fileHandled: true,
      warningText: null,
      imageBase64ForMediaSearch: null,
      imageMimeForMediaSearch: null,
    };
  }

  if (hasFileInput) {
    logger?.(`file not handled: messageText=${Boolean(messageText)}`);
    if (!messageText) {
      return {
        messagesToAppend: [],
        fileHandled: false,
        warningText: "⚠️ Failed to process the file you sent. Please try again or send as a different format.",
        imageBase64ForMediaSearch: null,
        imageMimeForMediaSearch: null,
      };
    }
    return {
      messagesToAppend: [{ role: "user", content: messageText }],
      fileHandled: false,
      warningText: "⚠️ File could not be loaded. Responding to your text only.",
      imageBase64ForMediaSearch: null,
      imageMimeForMediaSearch: null,
    };
  }

  return {
    messagesToAppend: [{ role: "user", content: messageText }],
    fileHandled: false,
    warningText: null,
    imageBase64ForMediaSearch: null,
    imageMimeForMediaSearch: null,
  };
}
