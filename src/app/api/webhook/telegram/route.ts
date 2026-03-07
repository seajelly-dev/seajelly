import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const message = body.message || body.edited_message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const updateId = body.update_id;
    const dedupKey = `tg:${chatId}:${updateId}`;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, dedup: true });
    }

    const { data: defaultAgent } = await supabase
      .from("agents")
      .select("id")
      .eq("is_default", true)
      .limit(1)
      .single();

    const agentId = defaultAgent?.id ?? null;

    await supabase.from("events").insert({
      source: "telegram",
      agent_id: agentId,
      chat_id: chatId,
      dedup_key: dedupKey,
      payload: {
        update_id: updateId,
        message: {
          message_id: message.message_id,
          text: message.text,
          from: message.from,
          chat: message.chat,
          date: message.date,
        },
      },
      status: "pending",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
