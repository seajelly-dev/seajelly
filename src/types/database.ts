export interface Admin {
  id: string;
  auth_uid: string;
  email: string;
  is_super_admin: boolean;
  created_at: string;
}

export interface Secret {
  id: string;
  key_name: string;
  encrypted_value: string;
  created_by: string | null;
  updated_at: string;
}

export type AccessMode = "open" | "whitelist";

export interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  tools_config: Record<string, unknown>;
  memory_namespace: string;
  model: string;
  is_default: boolean;
  access_mode: AccessMode;
  ai_soul: string;
  telegram_bot_token: string | null;
  mcp_server_ids: string[];
  created_at: string;
}

export type Platform = "telegram" | "discord" | "slack" | "web";

export interface Channel {
  id: string;
  agent_id: string;
  platform: Platform;
  platform_uid: string;
  display_name: string | null;
  user_soul: string;
  is_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface Session {
  id: string;
  platform_chat_id: string;
  agent_id: string;
  channel_id: string | null;
  messages: ChatMessage[];
  metadata: Record<string, unknown>;
  version: number;
  is_active: boolean;
  updated_at: string;
}

export type MemoryCategory =
  | "fact"
  | "preference"
  | "decision"
  | "summary"
  | "other";

export interface Memory {
  id: string;
  agent_id: string;
  namespace: string;
  category: MemoryCategory;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ChunkStatus = "pending_embedded" | "embedded" | "embed_failed";

export interface MemoryChunk {
  id: string;
  memory_id: string;
  chunk_text: string;
  embedding: number[] | null;
  content_hash: string;
  embed_model: string | null;
  status: ChunkStatus;
  start_line: number | null;
  end_line: number | null;
  created_at: string;
}

export interface CronJob {
  id: string;
  agent_id: string;
  schedule: string;
  task_type: string;
  task_config: Record<string, unknown>;
  enabled: boolean;
  last_run: string | null;
  created_at: string;
}

export type EventSource = "telegram" | "cron" | "webhook" | "manual";
export type EventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "dead";

export interface AgentEvent {
  id: string;
  source: EventSource;
  agent_id: string | null;
  platform_chat_id: string | null;
  dedup_key: string | null;
  payload: Record<string, unknown>;
  status: EventStatus;
  locked_until: string | null;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  trace_id: string;
  created_at: string;
  processed_at: string | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  tool_schema: Record<string, unknown> | null;
  source_url: string | null;
  created_at: string;
}

export type McpTransport = "http" | "sse";

export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  headers: Record<string, string>;
  enabled: boolean;
  created_at: string;
}

export const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "EMBEDDING_API_KEY",
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];
