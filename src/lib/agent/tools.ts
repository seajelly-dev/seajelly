import { tool } from "ai";
import { z } from "zod/v4";
import { createClient } from "@supabase/supabase-js";

function extractKeywords(text: string): string[] {
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function createAgentTools(agentId: string, namespace: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  return {
    memory_write: tool({
      description:
        "Save a fact/preference/decision to long-term memory. " +
        "This tool automatically deduplicates: if an existing memory in the same " +
        "category shares significant overlap with the new content, it will be replaced. " +
        "Always provide the COMPLETE and LATEST version of the information.",
      inputSchema: z.object({
        category: z
          .enum(["fact", "preference", "decision", "summary", "other"])
          .describe("Category of the memory"),
        content: z
          .string()
          .describe("The full, up-to-date memory content. Must be self-contained."),
      }),
      execute: async ({
        category,
        content,
      }: {
        category: string;
        content: string;
      }) => {
        const { data: existing } = await supabase
          .from("memories")
          .select("id, content")
          .eq("agent_id", agentId)
          .eq("namespace", namespace)
          .eq("category", category);

        if (existing && existing.length > 0) {
          const newKw = new Set(extractKeywords(content.toLowerCase()));
          const toDelete: string[] = [];

          for (const mem of existing) {
            const oldKw = extractKeywords((mem.content as string).toLowerCase());
            if (oldKw.length === 0) continue;
            const overlap = oldKw.filter((w) => newKw.has(w)).length;
            if (overlap / oldKw.length >= 0.4) {
              toDelete.push(mem.id);
            }
          }

          if (toDelete.length > 0) {
            await supabase.from("memories").delete().in("id", toDelete);
          }
        }

        const { error } = await supabase.from("memories").insert({
          agent_id: agentId,
          namespace,
          category,
          content,
        });
        if (error) return { success: false, error: error.message };

        const replaced = existing && existing.length > 0 ? " (auto-deduplicated)" : "";
        return { success: true, message: `Memory saved${replaced}` };
      },
    }),

    memory_search: tool({
      description:
        "Search long-term memories for relevant information. Use this to recall facts about the user or previous decisions.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search query to find relevant memories"),
      }),
      execute: async ({ query }: { query: string }) => {
        const { data, error } = await supabase
          .from("memories")
          .select("category, content, created_at")
          .eq("agent_id", agentId)
          .eq("namespace", namespace)
          .ilike("content", `%${query}%`)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) return { success: false, error: error.message };
        return { success: true, memories: data };
      },
    }),

    get_current_time: tool({
      description: "Get the current date and time in ISO format.",
      inputSchema: z.object({}),
      execute: async () => {
        return { time: new Date().toISOString() };
      },
    }),
  };
}
