import { isImageMime, isTextMime } from "@/lib/platform/file-utils";
import type { BuildInboundUserMessagesParams, MediaMessageBuildResult } from "./types";

export function buildInboundUserMessages(
  params: BuildInboundUserMessagesParams,
): MediaMessageBuildResult {
  const { stagedFile, hasFileInput, messageText, logger } = params;

  if (stagedFile) {
    const mime = stagedFile.mimeType;
    const textPrompt = messageText || "";
    const hasUrl = !!stagedFile.publicUrl;

    if (isImageMime(mime)) {
      const imageContent = hasUrl
        ? { type: "image" as const, image: new URL(stagedFile.publicUrl!) }
        : { type: "image" as const, image: stagedFile.base64!, mediaType: stagedFile.effectiveImageMime };

      return {
        userMessages: [
          {
            role: "user",
            content: [
              imageContent,
              { type: "text", text: textPrompt || "Please describe or analyze this image." },
            ],
          },
        ],
        fileHandled: true,
        userWarning: null,
        imageBase64ForMediaSearch: stagedFile.base64,
        imageMimeForMediaSearch: stagedFile.effectiveImageMime,
        imageUrlForMediaSearch: stagedFile.publicUrl,
      };
    }

    if (isTextMime(mime)) {
      let textContent: string;
      if (stagedFile.base64) {
        textContent = Buffer.from(stagedFile.base64, "base64").toString("utf-8");
      } else if (stagedFile.publicUrl) {
        textContent = `[File available at: ${stagedFile.publicUrl}]`;
      } else {
        textContent = "[File content unavailable]";
      }
      const label = stagedFile.fileName ? `[File: ${stagedFile.fileName}]` : "[Text file]";
      return {
        userMessages: [
          {
            role: "user",
            content: `${label}\n\`\`\`\n${textContent.slice(0, 50_000)}\n\`\`\`\n\n${textPrompt || "Please analyze this file."}`,
          },
        ],
        fileHandled: true,
        userWarning: null,
        imageBase64ForMediaSearch: null,
        imageMimeForMediaSearch: null,
        imageUrlForMediaSearch: null,
      };
    }

    if (mime === "application/pdf" || mime.startsWith("video/") || mime.startsWith("audio/")) {
      const defaultPrompt =
        mime === "application/pdf"
          ? "Please analyze this PDF document."
          : mime.startsWith("video/")
            ? "Please analyze this video."
            : "Please analyze this audio.";

      if (hasUrl) {
        return {
          userMessages: [
            {
              role: "user",
              content: [
                { type: "file" as const, data: new URL(stagedFile.publicUrl!), mediaType: mime },
                { type: "text", text: textPrompt || defaultPrompt },
              ],
            },
          ],
          fileHandled: true,
          userWarning: null,
          imageBase64ForMediaSearch: null,
          imageMimeForMediaSearch: null,
          imageUrlForMediaSearch: null,
        };
      }

      if (stagedFile.base64) {
        return {
          userMessages: [
            {
              role: "user",
              content: [
                { type: "file" as const, data: stagedFile.base64, mediaType: mime },
                { type: "text", text: textPrompt || defaultPrompt },
              ],
            },
          ],
          fileHandled: true,
          userWarning: null,
          imageBase64ForMediaSearch: null,
          imageMimeForMediaSearch: null,
          imageUrlForMediaSearch: null,
        };
      }
    }

    const label = stagedFile.fileName
      ? `[File: ${stagedFile.fileName}, type: ${mime}]`
      : `[File: ${mime}]`;
    return {
      userMessages: [
        {
          role: "user",
          content: `${label}\n(Binary file — ${stagedFile.sizeBytes} bytes)\n\n${textPrompt || "I sent you a file. What can you help me with?"}`,
        },
      ],
      fileHandled: true,
      userWarning: null,
      imageBase64ForMediaSearch: null,
      imageMimeForMediaSearch: null,
      imageUrlForMediaSearch: null,
    };
  }

  if (hasFileInput) {
    logger?.(`file not handled: messageText=${Boolean(messageText)}`);
    if (!messageText) {
      return {
        userMessages: [],
        fileHandled: false,
        userWarning: "⚠️ Failed to process the file you sent. Please try again or send as a different format.",
        imageBase64ForMediaSearch: null,
        imageMimeForMediaSearch: null,
        imageUrlForMediaSearch: null,
      };
    }
    return {
      userMessages: [{ role: "user", content: messageText }],
      fileHandled: false,
      userWarning: "⚠️ File could not be loaded. Responding to your text only.",
      imageBase64ForMediaSearch: null,
      imageMimeForMediaSearch: null,
      imageUrlForMediaSearch: null,
    };
  }

  return {
    userMessages: [{ role: "user", content: messageText }],
    fileHandled: false,
    userWarning: null,
    imageBase64ForMediaSearch: null,
    imageMimeForMediaSearch: null,
    imageUrlForMediaSearch: null,
  };
}
