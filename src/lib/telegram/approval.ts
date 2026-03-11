import { getBotForAgent } from "./bot";
import { getSenderForAgent } from "@/lib/platform/sender";
import {
  processChannelApproval,
  processPushApproval,
} from "@/lib/platform/approval-core";
import { getAgentLocale } from "@/lib/platform/approval-core";
import { botT, getBotLocaleOrDefault, buildWelcomeText } from "@/lib/i18n/bot";
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
          const rawLocale = await getAgentLocale(agentId);
          const locale = getBotLocaleOrDefault(rawLocale);
          const bot = await getBotForAgent(agentId);
          await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "alreadyProcessed") });
        }
      } catch { /* ignore */ }
      return;
    }

    const rawLocale = await getAgentLocale(result.agentId);
    const locale = getBotLocaleOrDefault(rawLocale);

    const bot = await getBotForAgent(result.agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (action === "approve") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "approvedShort", { name: result.name }) });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, botT(locale, "approved", { name: result.name }));
      }
      if (result.targetUid) {
        try {
          const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
          await targetSender.sendText(result.targetUid, botT(locale, "accessApproved"));
          const { data: agentRow } = await (await import("@supabase/supabase-js")).createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          ).from("agents").select("name").eq("id", result.agentId).single();
          const agentName = (agentRow as { name?: string } | null)?.name || "Agent";
          const welcomeText = buildWelcomeText(locale, agentName, result.targetPlatform);
          await targetSender.sendMarkdown(result.targetUid, welcomeText);
        } catch { /* user may have blocked bot or platform unavailable */ }
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "rejectedShort", { name: result.name }) });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, botT(locale, "rejected", { name: result.name }));
      }
      if (result.targetUid) {
        try {
          const targetSender = await getSenderForAgent(result.agentId, result.targetPlatform);
          await targetSender.sendText(result.targetUid, botT(locale, "accessRejected"));
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

    const rawLocale = await getAgentLocale(result.agentId);
    const locale = getBotLocaleOrDefault(rawLocale);

    const bot = await getBotForAgent(result.agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (result.status === "expired") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "pushExpired") });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, botT(locale, "pushExpiredTitle"));
      }
      return;
    }

    if (result.status === "already_processed") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "pushAlreadyProcessed") });
      return;
    }

    if (action === "approve") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "pushApproved") });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, botT(locale, "pushApprovedTitle", { summary: result.summary }));
      }
    } else {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: botT(locale, "pushRejected") });
      if (chatId && messageId) {
        await safeEditMessage(bot, chatId, messageId, botT(locale, "pushRejectedTitle", { summary: result.summary }));
      }
    }

    if (result.requesterUid) {
      const sender = await getSenderForAgent(result.agentId, "telegram");
      try {
        await sender.sendText(
          result.requesterUid,
          action === "approve"
            ? botT(locale, "pushApprovedNotify")
            : botT(locale, "pushRejectedNotify"),
        );
      } catch { /* user may have blocked bot */ }
    }
  }
}
