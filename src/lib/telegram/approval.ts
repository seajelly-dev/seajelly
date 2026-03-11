import { getBotForAgent } from "./bot";
import { getSenderForAgent } from "@/lib/platform/sender";
import {
  processChannelApproval,
  processPushApproval,
} from "@/lib/platform/approval-core";
import type { Bot } from "grammy";

interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}

async function safeEditMessage(
  bot: Bot,
  chatId: number,
  messageId: number,
  text: string,
) {
  const noButtons = { reply_markup: { inline_keyboard: [] as never[] } };
  try {
    await bot.api.editMessageText(chatId, messageId, text, { parse_mode: "Markdown", ...noButtons });
  } catch {
    await bot.api.editMessageText(chatId, messageId, text.replace(/[*_`\[\]]/g, ""), noButtons).catch(() => {});
  }
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
    if (!result) {
      try {
        const agentId = fallbackAgentId;
        if (agentId) {
          const bot = await getBotForAgent(agentId);
          await bot.api.answerCallbackQuery(callbackQuery.id, { text: "⚠️ Already processed" });
        }
      } catch { /* ignore */ }
      return;
    }

    const bot = await getBotForAgent(result.agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (action === "approve") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `✅ ${result.name} approved` });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, `✅ *Approved:* ${result.name}`);
      }
      if (result.targetUid) {
        try {
          const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
          await targetSender.sendText(result.targetUid, "✅ Your access has been approved! You can start chatting now.");
        } catch { /* user may have blocked bot or platform unavailable */ }
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `❌ ${result.name} rejected` });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, `❌ *Rejected:* ${result.name}`);
      }
      if (result.targetUid) {
        try {
          const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
          await targetSender.sendText(result.targetUid, "❌ Your access request has been rejected.");
        } catch { /* user may have blocked bot or platform unavailable */ }
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
        await safeEditMessage(bot, chatId, messageId, "⏱️ *Push approval expired*");
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
        await safeEditMessage(bot, chatId, messageId, `✅ *Push Approved*\n\n${result.summary}`);
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "❌ Push rejected" });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, `❌ *Push Rejected*\n\n${result.summary}`);
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
