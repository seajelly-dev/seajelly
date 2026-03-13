import { isImageMime } from "@/lib/platform/file-utils";
import type { HandlePendingImageEditParams, ImageEditInterceptResult } from "./types";

export async function handlePendingImageEdit(
  params: HandlePendingImageEditParams,
): Promise<ImageEditInterceptResult | null> {
  const {
    resolvedFile,
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
  if (!sessionMeta.imgedit_pending || !resolvedFile || !isImageMime(resolvedFile.mimeType)) {
    return null;
  }

  const editPrompt = (messageText || (sessionMeta.imgedit_prompt as string) || "").trim();
  if (!editPrompt) {
    await sender.sendText(platformChatId, t("imgeditNoPrompt"));
    return {
      handled: true,
      loopResult: { success: true, reply: "imgedit_no_prompt", traceId },
    };
  }

  await sender.sendTyping(platformChatId);
  const typingTimer = setInterval(() => {
    sender.sendTyping(platformChatId).catch(() => {});
  }, 4000);

  try {
    const generateImage =
      generateImageOverride ??
      (await import("@/lib/image-gen/engine")).generateImage;
    const result = await generateImage({
      prompt: editPrompt,
      sourceImageBase64: resolvedFile.base64,
      sourceMimeType: resolvedFile.mimeType,
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
    loopResult: { success: true, reply: "imgedit_done", traceId },
  };
}
