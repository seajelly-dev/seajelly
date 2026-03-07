import { createClient } from "@supabase/supabase-js";
import type { Memory, MemoryCategory } from "@/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function writeFact(
  agentId: string,
  namespace: string,
  category: MemoryCategory,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memories").insert({
    agent_id: agentId,
    namespace,
    category,
    content,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function searchFacts(
  agentId: string,
  namespace: string,
  query: string,
  limit = 10
): Promise<Memory[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("memories")
    .select("*")
    .eq("agent_id", agentId)
    .eq("namespace", namespace)
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as Memory[]) ?? [];
}

export async function getRecentFacts(
  agentId: string,
  namespace: string,
  limit = 5
): Promise<Memory[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("memories")
    .select("*")
    .eq("agent_id", agentId)
    .eq("namespace", namespace)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as Memory[]) ?? [];
}
