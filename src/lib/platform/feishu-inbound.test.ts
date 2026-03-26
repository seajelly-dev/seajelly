import assert from "node:assert/strict";
import test from "node:test";
import { extractFeishuInboundMessage } from "@/lib/platform/feishu-inbound";

test("extractFeishuInboundMessage keeps plain text messages unchanged", () => {
  const result = extractFeishuInboundMessage({
    messageType: "text",
    content: JSON.stringify({ text: "这视频有意思吗" }),
    messageId: "om_text",
  });

  assert.deepEqual(result, {
    text: "这视频有意思吗",
    fileRef: null,
    fileMime: null,
    fileName: null,
  });
});

test("extractFeishuInboundMessage captures media tags inside post messages", () => {
  const result = extractFeishuInboundMessage({
    messageType: "post",
    content: JSON.stringify({
      zh_cn: {
        content: [
          [{ tag: "media", file_key: "file_v3_media", image_key: "img_cover" }],
          [{ tag: "text", text: "这视频有意思吗" }],
        ],
      },
    }),
    messageId: "om_post",
  });

  assert.deepEqual(result, {
    text: "这视频有意思吗",
    fileRef: "om_post|file_v3_media|file",
    fileMime: "video/mp4",
    fileName: null,
  });
});

test("extractFeishuInboundMessage prefers post media over images when both exist", () => {
  const result = extractFeishuInboundMessage({
    messageType: "post",
    content: JSON.stringify({
      zh_cn: {
        content: [
          [{ tag: "img", image_key: "img_first" }],
          [{ tag: "media", file_key: "file_v3_media" }],
          [{ tag: "text", text: "看这个" }],
        ],
      },
    }),
    messageId: "om_post_mixed",
  });

  assert.deepEqual(result, {
    text: "看这个",
    fileRef: "om_post_mixed|file_v3_media|file",
    fileMime: "video/mp4",
    fileName: null,
  });
});

test("extractFeishuInboundMessage captures direct media messages and preserves filename-derived mime", () => {
  const result = extractFeishuInboundMessage({
    messageType: "media",
    content: JSON.stringify({
      file_key: "file_v3_video",
      file_name: "clip.mov",
      image_key: "img_cover",
    }),
    messageId: "om_media",
  });

  assert.deepEqual(result, {
    text: "",
    fileRef: "om_media|file_v3_video|file",
    fileMime: "video/quicktime",
    fileName: "clip.mov",
  });
});

test("extractFeishuInboundMessage still handles direct file messages", () => {
  const result = extractFeishuInboundMessage({
    messageType: "file",
    content: JSON.stringify({
      file_key: "file_v3_doc",
      file_name: "brief.pdf",
    }),
    messageId: "om_file",
  });

  assert.deepEqual(result, {
    text: "",
    fileRef: "om_file|file_v3_doc|file",
    fileMime: "application/pdf",
    fileName: "brief.pdf",
  });
});
