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
  "EMBEDDING_API_KEY",
  "E2B_API_KEY",
  "GITHUB_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];
