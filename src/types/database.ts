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

export interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  tools_config: Record<string, unknown>;
  memory_namespace: string;
  model: string;
  is_default: boolean;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface Session {
  id: string;
  chat_id: number;
  agent_id: string;
  messages: ChatMessage[];
  metadata: Record<string, unknown>;
  version: number;
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
  chat_id: number | null;
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

export const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "EMBEDDING_API_KEY",
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];
