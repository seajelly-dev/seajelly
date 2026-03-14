import { isImageMime } from "@/lib/platform/file-utils";
import type { HandlePendingImageEditParams, ImageEditInterceptResult } from "./types";

async function resolveBase64(stagedFile: { base64: string | null; publicUrl: string | null }): Promise<string | null> {
  if (stagedFile.base64) return stagedFile.base64;
  if (stagedFile.publicUrl) {
    const res = await fetch(stagedFile.publicUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  return null;
}

export async function handlePendingImageEdit(
  params: HandlePendingImageEditParams,
): Promise<ImageEditInterceptResult | null> {
  const {
    stagedFile,
    session,
    supabase,
    sender,
    platformChatId,
    messageText,
    t,
    traceId,
    generateImageOverride,
  } = params;
  const sessionMeta = (session.metadata ?? {}) as Record<string, unknown>;
  if (!sessionMeta.imgedit_pending || !stagedFile || !isImageMime(stagedFile.mimeType)) {
    return null;
  }

  const editPrompt = (messageText || (sessionMeta.imgedit_prompt as string) || "").trim();
  if (!editPrompt) {
    await sender.sendText(platformChatId, t("imgeditNoPrompt"));
    return {
      handled: true,
      result: { success: true, reply: "imgedit_no_prompt", traceId },
    };
  }

  await sender.sendTyping(platformChatId);
  const typingTimer = setInterval(() => {
    sender.sendTyping(platformChatId).catch(() => {});
  }, 4000);

  try {
    const base64 = await resolveBase64(stagedFile);
    if (!base64) throw new Error("Failed to retrieve image data for editing");

    const generateImage =
      generateImageOverride ??
      (await import("@/lib/image-gen/engine")).generateImage;
    const result = await generateImage({
      prompt: editPrompt,
      sourceImageBase64: base64,
      sourceMimeType: stagedFile.mimeType,
    });
    const imageBuffer = Buffer.from(result.imageBase64, "base64");
    await sender.sendPhoto(platformChatId, imageBuffer, result.textResponse || undefined);
    await sender.sendText(platformChatId, t("imgeditSuccess", { ms: result.durationMs }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    await sender.sendText(platformChatId, t("imgeditFailed", { error: errMsg }));
  } finally {
    clearInterval(typingTimer);
    await supabase
      .from("sessions")
      .update({ metadata: { ...sessionMeta, imgedit_pending: false, imgedit_prompt: null } })
      .eq("id", session.id);
  }

  return {
    handled: true,
    result: { success: true, reply: "imgedit_done", traceId },
  };
}
