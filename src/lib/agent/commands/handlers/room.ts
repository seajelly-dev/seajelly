import { getSenderForAgent } from "@/lib/platform/sender";
import type { CommandContext, LoopResult } from "../types";

export async function handleRoom(ctx: CommandContext): Promise<LoopResult> {
  const { supabase, sender, platformChatId, agent, channel, platform, messageText, t, traceId } = ctx;

  if (!channel?.is_owner) {
    await sender.sendText(platformChatId, t("roomOwnerOnly"));
    return { success: true, reply: "owner only", traceId };
  }

  const roomTitle =
    messageText.replace(/^\/room\s*/i, "").trim() ||
    `Room ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  const { data: room, error: roomErr } = await supabase
    .from("chat_rooms")
    .insert({
      agent_id: agent.id,
      created_by: channel.id,
      title: roomTitle,
    })
    .select()
    .single();
  if (roomErr || !room) {
    await sender.sendText(platformChatId, t("roomCreateFailed"));
    return { success: false, error: "Failed to create chatroom", traceId };
  }

  const { buildRoomUrl } = await import("@/lib/room-token");
  const ownerUrl = buildRoomUrl(
    room.id,
    channel.id,
    platform,
    channel.display_name || "Owner",
    true,
  );

  await supabase.from("chat_room_messages").insert({
    room_id: room.id,
    sender_type: "system",
    sender_name: "System",
    content: `Chatroom "${roomTitle}" created`,
  });

  await sender.sendMarkdown(platformChatId, t("roomCreated", { title: roomTitle, url: ownerUrl }));

  const { data: channels } = await supabase
    .from("channels")
    .select("id, platform, platform_uid, display_name, is_allowed, is_owner")
    .eq("agent_id", agent.id)
    .eq("is_allowed", true);
  if (channels) {
    for (const ch of channels) {
      if (!ch.platform_uid || ch.id === channel.id) continue;
      try {
        const chUrl = buildRoomUrl(
          room.id,
          ch.id,
          ch.platform,
          ch.display_name || ch.platform_uid,
          ch.is_owner,
        );
        const chSender = await getSenderForAgent(agent.id, ch.platform);
        if (chSender) {
          await chSender.sendMarkdown(ch.platform_uid, t("roomBroadcast", { title: roomTitle, url: chUrl }));
        }
      } catch {
        /* skip failing channels */
      }
    }
  }

  return { success: true, reply: ownerUrl, traceId };
}

