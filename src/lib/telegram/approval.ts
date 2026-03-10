import { createClient } from "@supabase/supabase-js";
import { getBotForAgent } from "./bot";
import { getSenderForAgent } from "@/lib/platform/sender";
import {
  processChannelApproval,
  processPushApproval,
} from "@/lib/platform/approval-core";

interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}

export async function handleApprovalCallback(
  callbackQuery: CallbackQuery,
  fallbackAgentId: string | null
) {
  const data = callbackQuery.data;
  if (!data) return;

  const channelMatch = data.match(/^(approve|reject):(.+)$/);
  const pushMatch = data.match(/^push_(approve|reject):(.+)$/);
  if (!channelMatch && !pushMatch) return;

  const callerUid = String(callbackQuery.from.id);

  if (channelMatch) {
    const [, action, channelId] = channelMatch;
    const result = await processChannelApproval({
      action: action as "approve" | "reject",
      channelId,
      callerUid,
      fallbackAgentId,
    });
    if (!result) return;

    const bot = await getBotForAgent(result.agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (action === "approve") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `✅ ${result.name} approved` });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `✅ *Approved:* ${result.name}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
      if (result.targetUid) {
        const sender = await getSenderForAgent(result.agentId, "telegram");
        try {
          await sender.sendText(result.targetUid, "✅ Your access has been approved! You can start chatting now.");
        } catch { /* user may have blocked bot */ }
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `❌ ${result.name} rejected` });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `❌ *Rejected:* ${result.name}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
      if (result.targetUid) {
        const sender = await getSenderForAgent(result.agentId, "telegram");
        try {
          await sender.sendText(result.targetUid, "❌ Your access request has been rejected.");
        } catch { /* user may have blocked bot */ }
      }
    }
    return;
  }

  if (pushMatch) {
    const [, action, approvalId] = pushMatch;
    const result = await processPushApproval({
      action: action as "approve" | "reject",
      approvalId,
      callerUid,
      fallbackAgentId,
    });

    if (!result) return;

    const bot = await getBotForAgent(result.agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (result.status === "expired") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "⏱️ Approval expired" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, "⏱️ *Push approval expired*", {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
      return;
    }

    if (result.status === "already_processed") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "Already processed" });
      return;
    }

    if (action === "approve") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "✅ Push approved" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `✅ *Push Approved*\n\n${result.summary}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "❌ Push rejected" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `❌ *Push Rejected*\n\n${result.summary}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
    }

    if (result.requesterUid) {
      const sender = await getSenderForAgent(result.agentId, "telegram");
      try {
        await sender.sendText(
          result.requesterUid,
          action === "approve"
            ? "✅ Push approved. Please send a message from the owner account to tell the agent to proceed with pushing."
            : "❌ Push rejected by owner."
        );
      } catch { /* user may have blocked bot */ }
    }
  }
}
