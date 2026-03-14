import assert from "node:assert/strict";
import test from "node:test";
import { buildInboundUserMessages } from "@/lib/agent/media";
import type { StagedFile } from "@/lib/jellybox/storage";

function makeStagedFile(overrides: Partial<StagedFile> = {}): StagedFile {
  return {
    fileRecordId: null,
    publicUrl: null,
    base64: Buffer.from("hello").toString("base64"),
    mimeType: "text/plain",
    effectiveImageMime: "text/plain",
    fileName: "note.txt",
    sizeBytes: 5,
    ...overrides,
  };
}

test("buildInboundUserMessages creates image+text content for images (base64 fallback)", () => {
  const result = buildInboundUserMessages({
    stagedFile: makeStagedFile({
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

test("buildInboundUserMessages creates image+text content for images (URL mode)", () => {
  const result = buildInboundUserMessages({
    stagedFile: makeStagedFile({
      mimeType: "image/jpeg",
      effectiveImageMime: "image/jpeg",
      publicUrl: "https://r2.example.com/temp/test.jpg",
      base64: null,
      fileName: "pic.jpg",
    }),
    hasFileInput: true,
    messageText: "describe this",
  });

  assert.equal(result.fileHandled, true);
  assert.equal(result.imageUrlForMediaSearch, "https://r2.example.com/temp/test.jpg");
  assert.equal(result.imageBase64ForMediaSearch, null);
  const content = result.userMessages[0]?.content as Array<Record<string, unknown>>;
  assert.equal(content[0]?.type, "image");
  assert.ok(content[0]?.image instanceof URL);
});

test("buildInboundUserMessages truncates text files and preserves labels", () => {
  const longText = "a".repeat(60_000);
  const result = buildInboundUserMessages({
    stagedFile: makeStagedFile({
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

test("buildInboundUserMessages creates file+text content for pdf (base64)", () => {
  const result = buildInboundUserMessages({
    stagedFile: makeStagedFile({
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
    stagedFile: makeStagedFile({
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
    stagedFile: null,
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
    stagedFile: null,
    hasFileInput: true,
    messageText: "",
  });

  assert.equal(result.fileHandled, false);
  assert.equal(result.userMessages.length, 0);
  assert.match(result.userWarning ?? "", /Failed to process/);
});
