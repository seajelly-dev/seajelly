import { NextResponse } from "next/server";
import { verifyRoomToken } from "@/lib/room-token";
import { createRoomRealtimeSession } from "@/lib/room-realtime";
import { createStrictServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      room_id?: string;
      token?: string;
    };
    const roomId = body.room_id;
    const tokenStr = body.token;

    if (!roomId || !tokenStr) {
      return NextResponse.json({ error: "room_id and token are required" }, { status: 400 });
    }

    const token = verifyRoomToken(tokenStr);
    if (!token || token.r !== roomId) {
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
    }

    const supabase = createStrictServiceClient();
    const { data: room, error } = await supabase
      .from("chat_rooms")
      .select("id")
      .eq("id", roomId)
      .single();

    if (error || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const session = createRoomRealtimeSession(token);
    return NextResponse.json(session);
  } catch (err) {
    console.error("Room session error:", err);
    return NextResponse.json({ error: "Failed to create realtime session" }, { status: 500 });
  }
}
