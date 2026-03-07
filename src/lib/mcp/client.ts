import { createMCPClient } from "@ai-sdk/mcp";
import { createClient } from "@supabase/supabase-js";
import type { McpServer } from "@/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface MCPConnection {
  tools: Record<string, unknown>;
  close: () => Promise<void>;
}

async function connectSingle(
  server: McpServer
): Promise<MCPConnection | null> {
  try {
    const client = await createMCPClient({
      transport: {
        type: server.transport as "sse" | "http",
        url: server.url,
        headers: server.headers || {},
      },
    });

    const tools = await client.tools();
    return {
      tools,
      close: () => client.close(),
    };
  } catch (err) {
    console.warn(
      `MCP connect failed for "${server.name}" (${server.url}):`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export interface MCPResult {
  tools: Record<string, unknown>;
  cleanup: () => Promise<void>;
}

/**
 * Connect to multiple MCP servers by their IDs, collect all tools.
 * Failed connections are skipped with a warning.
 */
export async function connectMCPServers(
  serverIds: string[]
): Promise<MCPResult> {
  if (!serverIds.length) {
    return { tools: {}, cleanup: async () => {} };
  }

  const supabase = getSupabase();
  const { data: servers } = await supabase
    .from("mcp_servers")
    .select("*")
    .in("id", serverIds)
    .eq("enabled", true);

  if (!servers?.length) {
    return { tools: {}, cleanup: async () => {} };
  }

  const connections = await Promise.all(
    (servers as McpServer[]).map((s) => connectSingle(s))
  );

  const live = connections.filter(Boolean) as MCPConnection[];
  const merged: Record<string, unknown> = {};
  for (const conn of live) {
    Object.assign(merged, conn.tools);
  }

  return {
    tools: merged,
    cleanup: async () => {
      await Promise.allSettled(live.map((c) => c.close()));
    },
  };
}

/**
 * Test connection to an MCP server. Returns tool names on success.
 */
export async function testMCPConnection(
  url: string,
  transport: "http" | "sse",
  headers: Record<string, string> = {}
): Promise<{ success: boolean; tools?: string[]; error?: string }> {
  let client;
  try {
    client = await createMCPClient({
      transport: { type: transport, url, headers },
    });
    const tools = await client.tools();
    const toolNames = Object.keys(tools);
    return { success: true, tools: toolNames };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}
