import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandT } from "@/lib/agent/commands/types";
import { buildInboundUserMessages } from "@/lib/agent/media";
import { handlePendingImageEdit } from "@/lib/agent/media";
import type { ResolvedInboundFile } from "@/lib/agent/media";
import type { PlatformSender } from "@/lib/platform/types";
import type { Session } from "@/types/database";

function makeResolvedFile(overrides: Partial<ResolvedInboundFile> = {}): ResolvedInboundFile {
  return {
    base64: Buffer.from("hello").toString("base64"),
    mimeType: "text/plain",
    fileName: "note.txt",
    sizeBytes: 5,
    detectedImageMime: null,
    effectiveImageMime: "text/plain",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session_1",
    platform_chat_id: "chat_1",
    agent_id: "agent_1",
    channel_id: null,
    messages: [],
    metadata: {},
    active_skill_ids: [],
    version: 1,
    is_active: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSender() {
  const sent: Array<{ kind: string; text?: string; caption?: string }> = [];
  const sender: PlatformSender = {
    platform: "telegram",
    async sendText(_chatId, text) {
      sent.push({ kind: "text", text });
    },
    async sendMarkdown(_chatId, md) {
      sent.push({ kind: "markdown", text: md });
    },
    async sendTyping() {
      sent.push({ kind: "typing" });
    },
    async sendVoice() {},
    async sendPhoto(_chatId, _photo, caption) {
      sent.push({ kind: "photo", caption });
    },
    async sendInteractiveButtons() {},
  };
  return { sender, sent };
}

function makeT(): CommandT {
  return ((key: Parameters<CommandT>[0], params?: Parameters<CommandT>[1]) => {
    const safeKey = String(key);
    if (!params) return safeKey;
    const rendered = Object.entries(params as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(",");
    return `${safeKey}(${rendered})`;
  }) as CommandT;
}

test("buildInboundUserMessages creates image+text content for images", () => {
  const result = buildInboundUserMessages({
    resolvedFile: makeResolvedFile({
      mimeType: "image/jpeg",
      effectiveImageMime: "image/png",
      base64: "abc123",
      fileName: "pic.jpg",
    }),
    hasFileInput: true,
    messageText: "",
  });

  assert.equal(result.fileHandled, true);
  assert.equal(result.imageBase64ForMediaSearch, "abc123");
  assert.equal(result.imageMimeForMediaSearch, "image/png");
  assert.equal(result.userMessages.length, 1);
  const content = result.userMessages[0]?.content as Array<Record<string, string>>;
  assert.equal(content[0]?.type, "image");
  assert.equal(content[0]?.mediaType, "image/png");
});

test("buildInboundUserMessages truncates text files and preserves labels", () => {
  const longText = "a".repeat(60_000);
  const result = buildInboundUserMessages({
    resolvedFile: makeResolvedFile({
      base64: Buffer.from(longText, "utf-8").toString("base64"),
      mimeType: "text/plain",
      effectiveImageMime: "text/plain",
      fileName: "doc.txt",
      sizeBytes: longText.length,
    }),
    hasFileInput: true,
    messageText: "",
  });

  assert.equal(result.fileHandled, true);
  const content = String(result.userMessages[0]?.content);
  assert.match(content, /\[File: doc\.txt\]/);
  assert.ok(content.length < longText.length);
});

test("buildInboundUserMessages creates file+text content for pdf", () => {
  const result = buildInboundUserMessages({
    resolvedFile: makeResolvedFile({
      mimeType: "application/pdf",
      effectiveImageMime: "application/pdf",
      base64: "pdfdata",
      fileName: "doc.pdf",
    }),
    hasFileInput: true,
    messageText: "",
  });

  const content = result.userMessages[0]?.content as Array<Record<string, string>>;
  assert.equal(content[0]?.type, "file");
  assert.match(content[1]?.text ?? "", /PDF/i);
});

test("buildInboundUserMessages creates binary description for unknown mime", () => {
  const result = buildInboundUserMessages({
    resolvedFile: makeResolvedFile({
      mimeType: "application/octet-stream",
      effectiveImageMime: "application/octet-stream",
      fileName: "blob.bin",
      sizeBytes: 42,
    }),
    hasFileInput: true,
    messageText: "",
  });

  assert.match(String(result.userMessages[0]?.content), /Binary file/);
  assert.equal(result.fileHandled, true);
});

test("buildInboundUserMessages falls back to text with warning when file download failed", () => {
  const result = buildInboundUserMessages({
    resolvedFile: null,
    hasFileInput: true,
    messageText: "hello",
  });

  assert.equal(result.fileHandled, false);
  assert.equal(result.userWarning, "⚠️ File could not be loaded. Responding to your text only.");
  assert.equal(result.userMessages.length, 1);
  assert.equal(result.userMessages[0]?.content, "hello");
});

test("buildInboundUserMessages returns early warning when file download failed and no text", () => {
  const result = buildInboundUserMessages({
    resolvedFile: null,
    hasFileInput: true,
    messageText: "",
  });

  assert.equal(result.fileHandled, false);
  assert.equal(result.userMessages.length, 0);
  assert.match(result.userWarning ?? "", /Failed to process/);
});

test("handlePendingImageEdit completes image edit and clears pending state", async () => {
  const updates: unknown[] = [];
  const supabase = {
    from() {
      return {
        update(payload: unknown) {
          updates.push(payload);
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  const { sender, sent } = makeSender();
  const session = makeSession({
    metadata: { imgedit_pending: true, imgedit_prompt: "make it brighter" },
  });

  const result = await handlePendingImageEdit({
    resolvedFile: makeResolvedFile({
      mimeType: "image/png",
      effectiveImageMime: "image/png",
      base64: Buffer.from("png").toString("base64"),
    }),
    session,
    supabase,
    sender,
    platformChatId: "chat_1",
    messageText: "",
    t: makeT(),
    traceId: "trace_1",
    generateImageOverride: async () => ({
      imageBase64: Buffer.from("edited").toString("base64"),
      textResponse: "done",
      durationMs: 123,
    }),
  });

  assert.equal(result?.handled, true);
  assert.equal(result?.result?.reply, "imgedit_done");
  assert.ok(sent.some((entry) => entry.kind === "typing"));
  assert.ok(sent.some((entry) => entry.kind === "photo"));
  assert.ok(sent.some((entry) => entry.text?.includes("imgeditSuccess")));
  assert.equal(updates.length, 1);
});

test("handlePendingImageEdit returns no-prompt without clearing pending", async () => {
  const updates: unknown[] = [];
  const supabase = {
    from() {
      return {
        update(payload: unknown) {
          updates.push(payload);
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  const { sender, sent } = makeSender();

  const result = await handlePendingImageEdit({
    resolvedFile: makeResolvedFile({
      mimeType: "image/png",
      effectiveImageMime: "image/png",
      base64: Buffer.from("png").toString("base64"),
    }),
    session: makeSession({
      metadata: { imgedit_pending: true, imgedit_prompt: null },
    }),
    supabase,
    sender,
    platformChatId: "chat_1",
    messageText: "",
    t: makeT(),
    traceId: "trace_1",
  });

  assert.equal(result?.handled, true);
  assert.equal(result?.result?.reply, "imgedit_no_prompt");
  assert.ok(sent.some((entry) => entry.text?.includes("imgeditNoPrompt")));
  assert.equal(updates.length, 0);
});

test("handlePendingImageEdit ignores non-image files", async () => {
  const supabase = {
    from() {
      throw new Error("should not update");
    },
  } as unknown as SupabaseClient;
  const { sender } = makeSender();

  const result = await handlePendingImageEdit({
    resolvedFile: makeResolvedFile({
      mimeType: "application/pdf",
      effectiveImageMime: "application/pdf",
    }),
    session: makeSession({
      metadata: { imgedit_pending: true, imgedit_prompt: "test" },
    }),
    supabase,
    sender,
    platformChatId: "chat_1",
    messageText: "",
    t: makeT(),
    traceId: "trace_1",
  });

  assert.equal(result, null);
});
