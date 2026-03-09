import { createClient } from "@supabase/supabase-js";
import type { Memory, MemoryCategory, MemoryScope } from "@/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function writeFact(
  agentId: string,
  channelId: string | null,
  category: MemoryCategory,
  content: string,
  scope: MemoryScope = "channel"
): Promise<{ success: boolean; error?: string }> {
  if (scope === "channel" && !channelId) {
    return { success: false, error: "channelId required for channel-scoped memory" };
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("memories").insert({
    agent_id: agentId,
    channel_id: scope === "channel" ? channelId : null,
    scope,
    category,
    content,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function searchFacts(
  agentId: string,
  channelId: string | null,
  query: string,
  limit = 10
): Promise<Memory[]> {
  const supabase = getSupabase();
  const orFilter = channelId
    ? `and(channel_id.eq.${channelId},scope.eq.channel),scope.eq.global`
    : `scope.eq.global`;

  const { data } = await supabase
    .from("memories")
    .select("*")
    .eq("agent_id", agentId)
    .or(orFilter)
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as Memory[]) ?? [];
}

export async function getRecentFacts(
  agentId: string,
  channelId: string | null,
  limit = 5
): Promise<Memory[]> {
  const supabase = getSupabase();
  const orFilter = channelId
    ? `and(channel_id.eq.${channelId},scope.eq.channel),scope.eq.global`
    : `scope.eq.global`;

  const { data } = await supabase
    .from("memories")
    .select("*")
    .eq("agent_id", agentId)
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as Memory[]) ?? [];
}
