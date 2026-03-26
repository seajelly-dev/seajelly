import { guessMime } from "./file-utils";

export interface ExtractedFeishuInboundMessage {
  text: string;
  fileRef: string | null;
  fileMime: string | null;
  fileName: string | null;
}

type FeishuPostElement = Record<string, unknown>;
type FeishuPostRows = FeishuPostElement[][];

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getPostRows(parsed: Record<string, unknown>): FeishuPostRows | null {
  if (Array.isArray(parsed.content)) {
    return parsed.content as FeishuPostRows;
  }

  const localized = parsed.zh_cn || parsed.en_us;
  if (
    localized
    && typeof localized === "object"
    && Array.isArray((localized as { content?: unknown }).content)
  ) {
    return (localized as { content: FeishuPostRows }).content;
  }

  return null;
}

function inferFeishuFileMime(messageType: string, fileName?: string | null): string | null {
  const resolvedName = fileName?.trim() || null;
  if (resolvedName) {
    const guessed = guessMime(resolvedName, null);
    if (guessed !== "application/octet-stream") {
      return guessed;
    }
  }

  if (messageType === "audio") return "audio/opus";
  if (messageType === "image") return "image/jpeg";
  if (messageType === "media" || messageType === "video") return "video/mp4";
  return null;
}

function extractPostMessage(content: string | null | undefined, messageId: string): ExtractedFeishuInboundMessage {
  const parsed = parseJsonObject(content);
  if (!parsed) {
    return {
      text: "",
      fileRef: null,
      fileMime: null,
      fileName: null,
    };
  }

  const rows = getPostRows(parsed);
  if (!rows) {
    return {
      text: "",
      fileRef: null,
      fileMime: null,
      fileName: null,
    };
  }

  const texts: string[] = [];
  let imageRef: string | null = null;
  let imageMime: string | null = null;
  let mediaRef: string | null = null;
  let mediaMime: string | null = null;
  let mediaName: string | null = null;

  for (const row of rows) {
    for (const element of row) {
      const tag = typeof element.tag === "string" ? element.tag : null;
      if (tag === "text" || tag === "a" || tag === "at") {
        const value =
          (typeof element.text === "string" && element.text)
          || (typeof element.user_name === "string" && element.user_name)
          || (typeof element.href === "string" && element.href)
          || "";
        if (value) texts.push(value);
        continue;
      }

      if (!imageRef && tag === "img" && typeof element.image_key === "string" && element.image_key) {
        imageRef = `${messageId}|${element.image_key}|image`;
        imageMime = "image/jpeg";
        continue;
      }

      if (!mediaRef && tag === "media" && typeof element.file_key === "string" && element.file_key) {
        mediaName = typeof element.file_name === "string" ? element.file_name : null;
        mediaRef = `${messageId}|${element.file_key}|file`;
        mediaMime = inferFeishuFileMime("media", mediaName);
      }
    }
  }

  return {
    text: texts.join("").trim(),
    fileRef: mediaRef || imageRef,
    fileMime: mediaMime || imageMime,
    fileName: mediaName,
  };
}

function extractBinaryMessage(
  messageType: string,
  content: string | null | undefined,
  messageId: string,
): ExtractedFeishuInboundMessage {
  const parsed = parseJsonObject(content);
  const fileName = parsed && typeof parsed.file_name === "string" ? parsed.file_name : null;
  const fileKey =
    parsed && typeof parsed.file_key === "string"
      ? parsed.file_key
      : parsed && typeof parsed.image_key === "string"
        ? parsed.image_key
        : null;

  if (!fileKey) {
    return {
      text: "",
      fileRef: null,
      fileMime: null,
      fileName,
    };
  }

  const resourceType = messageType === "image" ? "image" : "file";
  return {
    text: "",
    fileRef: `${messageId}|${fileKey}|${resourceType}`,
    fileMime: inferFeishuFileMime(messageType, fileName),
    fileName,
  };
}

export function extractFeishuInboundMessage(params: {
  messageType: string;
  content: string | null | undefined;
  messageId: string;
}): ExtractedFeishuInboundMessage | null {
  const { messageType, content, messageId } = params;

  if (messageType === "text") {
    const parsed = parseJsonObject(content);
    return {
      text:
        parsed && typeof parsed.text === "string"
          ? parsed.text
          : content || "",
      fileRef: null,
      fileMime: null,
      fileName: null,
    };
  }

  if (messageType === "post") {
    return extractPostMessage(content, messageId);
  }

  if (
    messageType === "audio"
    || messageType === "file"
    || messageType === "image"
    || messageType === "media"
    || messageType === "video"
  ) {
    return extractBinaryMessage(messageType, content, messageId);
  }

  return null;
}
