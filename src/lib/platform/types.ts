export interface SendOptions {
  parseMode?: "Markdown" | "HTML" | "plain";
}

export interface ButtonRow {
  label: string;
  callbackData: string;
}

export interface PlatformSender {
  readonly platform: string;
  sendText(chatId: string, text: string, options?: SendOptions): Promise<void>;
  sendMarkdown(chatId: string, md: string): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
  sendVoice(chatId: string, audio: Buffer, filename?: string): Promise<void>;
  sendPhoto(chatId: string, photo: Buffer, caption?: string): Promise<void>;
  sendInteractiveButtons(
    chatId: string,
    text: string,
    buttons: ButtonRow[][],
    options?: SendOptions,
  ): Promise<void>;
}

export interface PlatformFile {
  base64: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
}

export interface PlatformFileDownloader {
  download(
    agentId: string,
    fileRef: string,
    hintMime?: string | null,
    hintName?: string | null,
  ): Promise<PlatformFile | null>;
}

export class NullFileDownloader implements PlatformFileDownloader {
  async download(): Promise<PlatformFile | null> {
    return null;
  }
}
