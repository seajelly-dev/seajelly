import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { getModel } from "@/lib/agent/provider";
import type { Agent } from "@/types/database";

function getSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("id");

  if (!roomId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
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
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { room_id, sender_name, platform, content } = body;

  if (!room_id || !sender_name || !content) {
    return NextResponse.json(
      { error: "room_id, sender_name, and content are required" },
      { status: 400 }
    );
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

  const { data: msg, error: msgErr } = await supabase
    .from("chat_room_messages")
    .insert({
      room_id,
      sender_type: "user",
      sender_name,
      platform: platform || "web",
      content,
    })
    .select()
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const mentionsAgent = /@agent\b/i.test(content);

  if (mentionsAgent) {
    handleAgentReply(supabase, room, content, sender_name).catch(console.error);
  }

  return NextResponse.json({ message: msg, agent_triggered: mentionsAgent });
}

async function handleAgentReply(
  supabase: ReturnType<typeof getSupabase>,
  room: Record<string, unknown>,
  userContent: string,
  userName: string
) {
  try {
    const agentId = room.agent_id as string;
    const roomId = room.id as string;

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
      .map((m) => `[${m.sender_type === "agent" ? "Assistant" : m.sender_name}]: ${m.content}`)
      .join("\n");

    const { model } = await getModel(typedAgent.model, typedAgent.provider_id);
    const systemPrompt =
      (typedAgent.system_prompt || "") +
      "\n\nYou are participating in a cross-platform chatroom. " +
      "Users may @agent to ask you questions. Reply concisely and helpfully. " +
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
      room_id: room.id as string,
      sender_type: "system",
      sender_name: "System",
      content: "Agent failed to respond. Please try again.",
    });
  }
}
