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

export type AccessMode = "open" | "approval" | "subscription";

export interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  tools_config: Record<string, unknown>;
  memory_namespace: string;
  model: string;
  provider_id: string | null;
  is_default: boolean;
  access_mode: AccessMode;
  ai_soul: string;
  telegram_bot_token: string | null;
  bot_locale: "en" | "zh";
  created_at: string;
}

export interface AgentCredential {
  id: string;
  agent_id: string;
  platform: string;
  credential_type: string;
  encrypted_value: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ProviderType = "anthropic" | "openai" | "google" | "deepseek" | "openai_compatible";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string | null;
  is_builtin: boolean;
  enabled: boolean;
  created_at: string;
}

export interface ProviderApiKey {
  id: string;
  provider_id: string;
  encrypted_value: string;
  label: string;
  is_active: boolean;
  call_count: number;
  weight: number;
  cooldown_until: string | null;
  cooldown_reason: string | null;
  created_at: string;
}

export interface Model {
  id: string;
  model_id: string;
  label: string;
  provider_id: string;
  is_builtin: boolean;
  enabled: boolean;
  created_at: string;
}

export interface ApiUsageLog {
  id: string;
  agent_id: string | null;
  provider_id: string | null;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number | null;
  created_at: string;
}

export type Platform = "telegram" | "wecom" | "feishu" | "slack" | "dingtalk" | "discord" | "web";

export interface Channel {
  id: string;
  agent_id: string;
  platform: Platform;
  platform_uid: string;
  display_name: string | null;
  user_soul: string;
  is_allowed: boolean;
  is_owner: boolean;
  trial_used: number;
  created_at: string;
  updated_at: string;
}

export type SubscriptionPlanType = "time" | "quota";

export interface SubscriptionPlan {
  id: string;
  agent_id: string;
  name: string;
  type: SubscriptionPlanType;
  duration_days: number | null;
  quota_amount: number | null;
  price_cents: number;
  currency: string;
  stripe_payment_link: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type FallbackAction = "require_approval" | "require_payment";

export interface SubscriptionRule {
  id: string;
  agent_id: string;
  trial_count: number;
  fallback_action: FallbackAction;
  expire_reminder_days: number;
  created_at: string;
  updated_at: string;
}

export type SubscriptionStatus = "active" | "expired" | "cancelled";

export interface ChannelSubscription {
  id: string;
  channel_id: string;
  plan_id: string | null;
  type: SubscriptionPlanType;
  starts_at: string | null;
  expires_at: string | null;
  quota_total: number | null;
  quota_used: number;
  payment_provider: string | null;
  payment_id: string | null;
  status: SubscriptionStatus;
  reminder_sent: boolean;
  created_at: string;
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
  active_skill_ids: string[];
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

export type MemoryScope = "channel" | "global";

export interface Memory {
  id: string;
  agent_id: string;
  channel_id: string | null;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
}

export type ArticleChunkStatus = "pending" | "chunking" | "chunked" | "chunk_failed";

export type MediaEmbedStatus = "none" | "embedding" | "embedded" | "failed";

export interface KnowledgeArticle {
  id: string;
  knowledge_base_id: string;
  title: string;
  content: string;
  source_url: string | null;
  chunk_status: ArticleChunkStatus;
  chunks_count: number;
  embedded_count?: number;
  total_chunks?: number;
  media_type: string | null;
  media_embed_model: string | null;
  media_embed_status: MediaEmbedStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ChunkEmbedStatus = "pending" | "embedded" | "failed";

export interface KnowledgeChunk {
  id: string;
  article_id: string;
  chunk_text: string;
  embedding: number[] | null;
  content_hash: string;
  embed_model: string | null;
  embed_status: ChunkEmbedStatus;
  chunk_index: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentKnowledgeBase {
  agent_id: string;
  knowledge_base_id: string;
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

export type EventSource = "telegram" | "wecom" | "feishu" | "slack" | "dingtalk" | "discord" | "cron" | "webhook" | "manual";
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

export type AgentStepPhase = "model" | "tool";
export type AgentStepStatus = "success" | "failed";

export interface AgentStepLog {
  id: string;
  trace_id: string;
  event_id: string | null;
  agent_id: string | null;
  channel_id: string | null;
  session_id: string | null;
  step_no: number | null;
  phase: AgentStepPhase;
  tool_name: string | null;
  tool_input_json: unknown;
  tool_output_json: unknown;
  model_text: string | null;
  status: AgentStepStatus;
  error_message: string | null;
  latency_ms: number | null;
  created_at: string;
  expires_at: string;
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

export interface SubApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tool_names: string[];
  enabled: boolean;
  created_at: string;
}

export type ChatRoomStatus = "active" | "closed";

export interface ChatRoom {
  id: string;
  agent_id: string;
  created_by: string | null;
  title: string | null;
  status: ChatRoomStatus;
  created_at: string;
  closed_at: string | null;
}

export type ChatRoomSenderType = "user" | "agent" | "system";

export interface ChatRoomMessage {
  id: string;
  room_id: string;
  sender_type: ChatRoomSenderType;
  sender_name: string;
  platform: string | null;
  channel_id: string | null;
  content: string;
  created_at: string;
}

export const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "EMBEDDING_API_KEY",
  "E2B_API_KEY",
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];
