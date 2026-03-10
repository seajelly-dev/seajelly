import { createClient } from "@supabase/supabase-js";
import { getBotForAgent } from "./bot";

interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
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
  const supabase = getSupabase();

  if (channelMatch) {
    const [, action, channelId] = channelMatch;

    const { data: ch } = await supabase
      .from("channels")
      .select("id, agent_id, platform_uid, display_name")
      .eq("id", channelId)
      .single();

    if (!ch) return;

    const agentId = ch.agent_id || fallbackAgentId;
    if (!agentId) return;

    const { data: ownerCh } = await supabase
      .from("channels")
      .select("platform_uid")
      .eq("agent_id", agentId)
      .eq("is_owner", true)
      .single();

    if (!ownerCh || ownerCh.platform_uid !== callerUid) return;

    const bot = await getBotForAgent(agentId);
    const name = ch.display_name || ch.platform_uid;
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    if (action === "approve") {
      await supabase.from("channels").update({ is_allowed: true }).eq("id", channelId);

      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `✅ ${name} approved` });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `✅ *Approved:* ${name}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }

      try {
        await bot.api.sendMessage(
          Number(ch.platform_uid),
          "✅ Your access has been approved! You can start chatting now."
        );
      } catch { /* user may have blocked bot */ }
    } else {
      await supabase.from("channels").delete().eq("id", channelId);

      await bot.api.answerCallbackQuery(callbackQuery.id, { text: `❌ ${name} rejected` });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `❌ *Rejected:* ${name}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }

      try {
        await bot.api.sendMessage(
          Number(ch.platform_uid),
          "❌ Your access request has been rejected."
        );
      } catch { /* user may have blocked bot */ }
    }
    return;
  }

  if (pushMatch) {
    const [, action, approvalId] = pushMatch;

    const { data: approval } = await supabase
      .from("github_push_approvals")
      .select("id, agent_id, request_channel_id, status, branch, commit_message, files, delete_files, expires_at")
      .eq("id", approvalId)
      .single();

    if (!approval) return;

    const agentId = approval.agent_id || fallbackAgentId;
    if (!agentId) return;

    const { data: ownerCh } = await supabase
      .from("channels")
      .select("platform_uid")
      .eq("agent_id", agentId)
      .eq("is_owner", true)
      .single();

    if (!ownerCh || ownerCh.platform_uid !== callerUid) return;

    const bot = await getBotForAgent(agentId);
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    const expiresAt = new Date(approval.expires_at as string).getTime();
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      if (approval.status === "pending") {
        await supabase
          .from("github_push_approvals")
          .update({ status: "expired" })
          .eq("id", approvalId);
      }
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "⏱️ Approval expired" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, "⏱️ *Push approval expired*", {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
      return;
    }

    if (approval.status !== "pending") {
      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "Already processed" });
      return;
    }

    const summary =
      `*Branch:* \`${approval.branch}\`\n` +
      `*Message:* ${approval.commit_message}\n`;

    if (action === "approve") {
      await supabase
        .from("github_push_approvals")
        .update({
          status: "approved",
          approved_by_uid: callerUid,
          approved_at: new Date().toISOString(),
        })
        .eq("id", approvalId);

      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "✅ Push approved" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `✅ *Push Approved*\n\n${summary}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
    } else {
      await supabase
        .from("github_push_approvals")
        .update({
          status: "rejected",
          approved_by_uid: callerUid,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", approvalId);

      await bot.api.answerCallbackQuery(callbackQuery.id, { text: "❌ Push rejected" });
      if (chatId && messageId) {
        await bot.api.editMessageText(chatId, messageId, `❌ *Push Rejected*\n\n${summary}`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      }
    }

    if (approval.request_channel_id) {
      const { data: requestCh } = await supabase
        .from("channels")
        .select("platform_uid")
        .eq("id", approval.request_channel_id)
        .single();

      if (requestCh?.platform_uid) {
        try {
          await bot.api.sendMessage(
            Number(requestCh.platform_uid),
            action === "approve"
              ? "✅ Push approved. Please send a message from the owner account to tell the agent to proceed with pushing."
              : "❌ Push rejected by owner."
          );
        } catch { /* user may have blocked bot */ }
      }
    }
  }
}
