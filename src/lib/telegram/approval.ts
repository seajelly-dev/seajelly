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

  const match = data.match(/^(approve|reject):(.+)$/);
  if (!match) return;

  const [, action, channelId] = match;
  const callerUid = String(callbackQuery.from.id);
  const supabase = getSupabase();

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
      });
    }

    try {
      await bot.api.sendMessage(
        Number(ch.platform_uid),
        "❌ Your access request has been rejected."
      );
    } catch { /* user may have blocked bot */ }
  }
}
