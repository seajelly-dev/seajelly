import { NextResponse, after } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/agent/provider";
import { verifyRoomToken } from "@/lib/room-token";
import { isSubAppConfigError } from "@/lib/sub-app-settings";
import { logApiUsage, readGenerateTextUsage } from "@/lib/usage/log";
import { createStrictServiceClient } from "@/lib/supabase/server";
import type { Agent } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

function getSupabase() {
  return createStrictServiceClient();
}

function roomUnavailableResponse() {
  return NextResponse.json(
    { error: "Room sub-app is not configured" },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("id");
  const tokenStr = searchParams.get("t");

  if (!roomId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (!tokenStr) {
    return NextResponse.json({ error: "Unauthorized: token required" }, { status: 401 });
  }

  let token;
  try {
    token = await verifyRoomToken(tokenStr);
  } catch (error) {
    if (isSubAppConfigError(error)) {
      return roomUnavailableResponse();
    }
    throw error;
  }
  if (!token || token.r !== roomId) {
    return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
  }

  const supabase = getSupabase();

  const { data: room, error: roomErr } = await supabase
    .from("chat_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (roomErr || !room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { data: messages } = await supabase
    .from("chat_room_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(200);

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name")
    .eq("id", room.agent_id)
    .single();

  return NextResponse.json({
    room,
    messages: messages ?? [],
    agent: agent ? { id: agent.id, name: agent.name } : null,
    identity: {
      channel_id: token.c,
      platform: token.p,
      display_name: token.n,
      is_owner: token.o,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { room_id, sender_name, platform, content, token: tokenStr } = body;

  if (!room_id || !sender_name || !content || !tokenStr) {
    return NextResponse.json(
      { error: "room_id, sender_name, content, and token are required" },
      { status: 400 }
    );
  }

  let token;
  try {
    token = await verifyRoomToken(tokenStr);
  } catch (error) {
    if (isSubAppConfigError(error)) {
      return roomUnavailableResponse();
    }
    throw error;
  }
  if (!token || token.r !== room_id) {
    return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
  }

  const supabase = getSupabase();

  const { data: room } = await supabase
    .from("chat_rooms")
    .select("*")
    .eq("id", room_id)
    .single();

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status === "closed") {
    return NextResponse.json({ error: "Room is closed" }, { status: 403 });
  }

  const agentId = room.agent_id as string;
  const { data: agent } = await supabase
    .from("agents")
    .select("name")
    .eq("id", agentId)
    .single();
  const agentName = agent?.name || "Agent";

  const { data: msg, error: msgErr } = await supabase
    .from("chat_room_messages")
    .insert({
      room_id,
      sender_type: "user",
      sender_name,
      platform: platform || "web",
      channel_id: token.c || null,
      content,
    })
    .select()
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const normalized = content.trim();
  const aliasMentioned = /@agent(?=$|\s|[,.!?，。！？:：;；])/i.test(normalized);
  const nameMentioned = normalized.includes(`@${agentName}`);
  const mentionsAgent = aliasMentioned || nameMentioned;

  if (mentionsAgent) {
    after(async () => {
      try {
        await handleAgentReply(supabase, room, content, sender_name);
      } catch (err) {
        console.error("after() agent reply error:", err);
      }
    });
  }

  return NextResponse.json({
    message: msg,
    agent_triggered: mentionsAgent,
    agent_name: agentName,
  });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { room_id, action, token: tokenStr } = body;

  if (!room_id || !action || !tokenStr) {
    return NextResponse.json(
      { error: "room_id, action, and token are required" },
      { status: 400 }
    );
  }

  let token;
  try {
    token = await verifyRoomToken(tokenStr);
  } catch (error) {
    if (isSubAppConfigError(error)) {
      return roomUnavailableResponse();
    }
    throw error;
  }
  if (!token || token.r !== room_id || !token.o) {
    return NextResponse.json({ error: "Unauthorized: owner only" }, { status: 403 });
  }

  const supabase = getSupabase();

  if (action === "close") {
    const { error } = await supabase
      .from("chat_rooms")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", room_id)
      .eq("status", "active");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("chat_room_messages").insert({
      room_id,
      sender_type: "system",
      sender_name: "System",
      content: "Chatroom has been closed by the owner.",
    });

    return NextResponse.json({ success: true, status: "closed" });
  }

  if (action === "reopen") {
    const { error } = await supabase
      .from("chat_rooms")
      .update({ status: "active", closed_at: null })
      .eq("id", room_id)
      .eq("status", "closed");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("chat_room_messages").insert({
      room_id,
      sender_type: "system",
      sender_name: "System",
      content: "Chatroom has been reopened by the owner.",
    });

    return NextResponse.json({ success: true, status: "active" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function handleAgentReply(
  supabase: ReturnType<typeof getSupabase>,
  room: Record<string, unknown>,
  userContent: string,
  userName: string
) {
  const agentId = room.agent_id as string;
  const roomId = room.id as string;

  try {
    const { data: agent } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (!agent) return;

    const typedAgent = agent as unknown as Agent;

    const { data: recentMsgs } = await supabase
      .from("chat_room_messages")
      .select("sender_type, sender_name, content")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(20);

    const context = (recentMsgs ?? [])
      .reverse()
      .map((m) => {
        const role = m.sender_type === "agent" ? typedAgent.name : m.sender_name;
        return `[${role}]: ${m.content}`;
      })
      .join("\n");

    const startedAt = Date.now();
    const { model, resolvedProviderId, pickedKeyId } = await getModel(typedAgent.model, typedAgent.provider_id);
    const systemPrompt =
      (typedAgent.system_prompt || "") +
      `\n\nYou are "${typedAgent.name}", participating in a cross-platform chatroom. ` +
      `Users mention you by typing @${typedAgent.name} to ask questions or chat. ` +
      "Reply concisely and helpfully in the same language the user is using. " +
      "Keep responses under 200 words unless a longer answer is needed.";

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Chatroom context:\n${context}\n\n${userName} says: ${userContent}`,
        },
      ],
      maxOutputTokens: 1024,
    });

    await logApiUsage({
      supabase,
      agentId,
      providerId: resolvedProviderId,
      modelId: typedAgent.model,
      keyId: pickedKeyId,
      durationMs: Date.now() - startedAt,
      usage: readGenerateTextUsage(result),
    });

    const reply = result.text?.trim();
    if (reply) {
      await supabase.from("chat_room_messages").insert({
        room_id: roomId,
        sender_type: "agent",
        sender_name: typedAgent.name,
        content: reply,
      });
    }
  } catch (err) {
    console.error("Agent reply in chatroom failed:", err);
    await supabase.from("chat_room_messages").insert({
      room_id: roomId,
      sender_type: "system",
      sender_name: "System",
      content: "Agent failed to respond. Please try again.",
    });
  }
}
