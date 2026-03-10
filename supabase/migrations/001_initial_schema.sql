-- OpenCrab Complete Schema (merged from 001 + 002)
-- This file is the single source of truth, kept in sync with SCHEMA_SQL in route.ts

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- 1. admins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid      uuid UNIQUE NOT NULL,
  email         text UNIQUE NOT NULL,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE auth_uid = auth.uid());
$fn$;

DROP POLICY IF EXISTS "admins_select_self" ON public.admins;
CREATE POLICY "admins_select_self" ON public.admins FOR SELECT USING (auth.uid() = auth_uid);
DROP POLICY IF EXISTS "admins_insert_first" ON public.admins;
CREATE POLICY "admins_insert_first" ON public.admins FOR INSERT WITH CHECK (
  (SELECT count(*) FROM public.admins) = 0
  OR public.is_admin()
);

-- ============================================================
-- 2. secrets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.secrets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name        text UNIQUE NOT NULL,
  encrypted_value text NOT NULL,
  created_by      uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "secrets_admin_all" ON public.secrets;
CREATE POLICY "secrets_admin_all" ON public.secrets FOR ALL USING (public.is_admin());

-- ============================================================
-- 3. providers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('anthropic','openai','google','deepseek','openai_compatible')),
  base_url    text,
  is_builtin  boolean NOT NULL DEFAULT false,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "providers_admin_all" ON public.providers;
CREATE POLICY "providers_admin_all" ON public.providers FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "providers_service_select" ON public.providers;
CREATE POLICY "providers_service_select" ON public.providers FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 4. provider_api_keys
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  encrypted_value text NOT NULL,
  label           text NOT NULL DEFAULT '',
  is_active       boolean NOT NULL DEFAULT true,
  call_count      int NOT NULL DEFAULT 0,
  weight          int NOT NULL DEFAULT 1,
  cooldown_until  timestamptz DEFAULT NULL,
  cooldown_reason text DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_api_keys_admin_all" ON public.provider_api_keys;
CREATE POLICY "provider_api_keys_admin_all" ON public.provider_api_keys FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "provider_api_keys_service_select" ON public.provider_api_keys;
CREATE POLICY "provider_api_keys_service_select" ON public.provider_api_keys FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 5. agents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  system_prompt     text NOT NULL DEFAULT '',
  tools_config      jsonb NOT NULL DEFAULT '{}',
  memory_namespace  text NOT NULL DEFAULT 'default',
  model             text NOT NULL DEFAULT 'claude-sonnet-4-6',
  provider_id       uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  is_default        boolean NOT NULL DEFAULT false,
  access_mode       text NOT NULL DEFAULT 'open' CHECK (access_mode IN ('open','approval','whitelist')),
  ai_soul           text NOT NULL DEFAULT '',
  telegram_bot_token text,
  webhook_secret    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_admin_all" ON public.agents;
CREATE POLICY "agents_admin_all" ON public.agents FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agents_public_select" ON public.agents;
DROP POLICY IF EXISTS "agents_service_select" ON public.agents;
CREATE POLICY "agents_service_select" ON public.agents FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 4. channels
-- ============================================================
CREATE TABLE IF NOT EXISTS public.channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('telegram','discord','slack','web')),
  platform_uid  text NOT NULL,
  display_name  text,
  user_soul     text NOT NULL DEFAULT '',
  is_allowed    boolean NOT NULL DEFAULT true,
  is_owner      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_agent_platform_uid ON public.channels(agent_id, platform, platform_uid);
CREATE INDEX IF NOT EXISTS channels_platform_uid ON public.channels(platform, platform_uid);
CREATE UNIQUE INDEX IF NOT EXISTS channels_agent_owner ON public.channels(agent_id) WHERE is_owner = true;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channels_admin_all" ON public.channels;
CREATE POLICY "channels_admin_all" ON public.channels FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "channels_public_rw" ON public.channels;
DROP POLICY IF EXISTS "channels_anon_select" ON public.channels;
DROP POLICY IF EXISTS "channels_service_select" ON public.channels;
CREATE POLICY "channels_service_select" ON public.channels FOR SELECT
  USING (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "channels_service_write" ON public.channels;
CREATE POLICY "channels_service_write" ON public.channels FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "channels_service_update" ON public.channels;
CREATE POLICY "channels_service_update" ON public.channels FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- ============================================================
-- 5. sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_chat_id  text NOT NULL,
  agent_id          uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  channel_id        uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  messages          jsonb NOT NULL DEFAULT '[]',
  metadata          jsonb NOT NULL DEFAULT '{}',
  version           int NOT NULL DEFAULT 1,
  is_active         boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_active ON public.sessions(platform_chat_id, agent_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS sessions_platform_chat ON public.sessions(platform_chat_id);
CREATE INDEX IF NOT EXISTS sessions_channel_id ON public.sessions(channel_id);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_admin_all" ON public.sessions;
CREATE POLICY "sessions_admin_all" ON public.sessions FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "sessions_public_select" ON public.sessions;
DROP POLICY IF EXISTS "sessions_service_upsert" ON public.sessions;
DROP POLICY IF EXISTS "sessions_service_update" ON public.sessions;
DROP POLICY IF EXISTS "sessions_service_select" ON public.sessions;
CREATE POLICY "sessions_service_select" ON public.sessions FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "sessions_service_insert" ON public.sessions;
CREATE POLICY "sessions_service_insert" ON public.sessions FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "sessions_service_upd" ON public.sessions;
CREATE POLICY "sessions_service_upd" ON public.sessions FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- ============================================================
-- 6. memories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  channel_id  uuid REFERENCES public.channels(id) ON DELETE CASCADE,
  scope       text NOT NULL DEFAULT 'channel' CHECK (scope IN ('channel','global')),
  category    text NOT NULL CHECK (category IN ('fact','preference','decision','summary','other')),
  content     text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memories_channel ON public.memories(channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memories_agent_global ON public.memories(agent_id) WHERE scope = 'global';
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_admin_all" ON public.memories;
CREATE POLICY "memories_admin_all" ON public.memories FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "memories_public_rw" ON public.memories;
DROP POLICY IF EXISTS "memories_service_all" ON public.memories;
CREATE POLICY "memories_service_all" ON public.memories FOR ALL
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 7. memory_chunks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.memory_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id     uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  chunk_text    text NOT NULL,
  embedding     vector(768),
  content_hash  text NOT NULL,
  embed_model   text,
  status        text NOT NULL DEFAULT 'pending_embedded' CHECK (status IN ('pending_embedded','embedded','embed_failed')),
  start_line    int,
  end_line      int,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_chunks_memory ON public.memory_chunks(memory_id);
CREATE INDEX IF NOT EXISTS memory_chunks_hash ON public.memory_chunks(content_hash);
ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_chunks_admin_all" ON public.memory_chunks;
CREATE POLICY "memory_chunks_admin_all" ON public.memory_chunks FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "memory_chunks_public_rw" ON public.memory_chunks;
DROP POLICY IF EXISTS "memory_chunks_service_all" ON public.memory_chunks;
CREATE POLICY "memory_chunks_service_all" ON public.memory_chunks FOR ALL
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 8. cron_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cron_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  schedule      text NOT NULL,
  task_type     text NOT NULL,
  task_config   jsonb NOT NULL DEFAULT '{}',
  enabled       boolean NOT NULL DEFAULT true,
  last_run      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cron_jobs_admin_all" ON public.cron_jobs;
CREATE POLICY "cron_jobs_admin_all" ON public.cron_jobs FOR ALL USING (public.is_admin());

-- ============================================================
-- 9. events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL CHECK (source IN ('telegram','cron','webhook','manual')),
  agent_id          uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  platform_chat_id  text,
  dedup_key         text UNIQUE,
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','dead')),
  locked_until    timestamptz,
  retry_count     int NOT NULL DEFAULT 0,
  max_retries     int NOT NULL DEFAULT 5,
  error_message   text,
  trace_id        text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS events_status_created ON public.events(status, created_at);
CREATE INDEX IF NOT EXISTS events_dedup ON public.events(dedup_key);
CREATE INDEX IF NOT EXISTS events_trace ON public.events(trace_id);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_admin_all" ON public.events;
CREATE POLICY "events_admin_all" ON public.events FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "events_public_rw" ON public.events;
DROP POLICY IF EXISTS "events_service_select" ON public.events;
CREATE POLICY "events_service_select" ON public.events FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "events_anon_insert" ON public.events;
DROP POLICY IF EXISTS "events_service_insert" ON public.events;
CREATE POLICY "events_service_insert" ON public.events FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "events_service_update" ON public.events;
CREATE POLICY "events_service_update" ON public.events FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- ============================================================
-- 10. skills
-- ============================================================
CREATE TABLE IF NOT EXISTS public.skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  content     text NOT NULL,
  tool_schema jsonb,
  source_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skills_admin_all" ON public.skills;
CREATE POLICY "skills_admin_all" ON public.skills FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "skills_public_select" ON public.skills;
DROP POLICY IF EXISTS "skills_service_select" ON public.skills;
CREATE POLICY "skills_service_select" ON public.skills FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 11. agent_skills (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_skills (
  agent_id  uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  skill_id  uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_skills_admin_all" ON public.agent_skills;
CREATE POLICY "agent_skills_admin_all" ON public.agent_skills FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agent_skills_public_select" ON public.agent_skills;
DROP POLICY IF EXISTS "agent_skills_service_select" ON public.agent_skills;
CREATE POLICY "agent_skills_service_select" ON public.agent_skills FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 12. mcp_servers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mcp_servers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  url         text NOT NULL,
  transport   text NOT NULL DEFAULT 'http' CHECK (transport IN ('http','sse')),
  headers     jsonb NOT NULL DEFAULT '{}',
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mcp_servers_admin_all" ON public.mcp_servers;
CREATE POLICY "mcp_servers_admin_all" ON public.mcp_servers FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "mcp_servers_public_select" ON public.mcp_servers;
DROP POLICY IF EXISTS "mcp_servers_service_select" ON public.mcp_servers;
CREATE POLICY "mcp_servers_service_select" ON public.mcp_servers FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 13. agent_mcps (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_mcps (
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  mcp_server_id uuid NOT NULL REFERENCES public.mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, mcp_server_id)
);
ALTER TABLE public.agent_mcps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_mcps_admin_all" ON public.agent_mcps;
CREATE POLICY "agent_mcps_admin_all" ON public.agent_mcps FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agent_mcps_public_select" ON public.agent_mcps;
DROP POLICY IF EXISTS "agent_mcps_service_select" ON public.agent_mcps;
CREATE POLICY "agent_mcps_service_select" ON public.agent_mcps FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 14. system_settings (key-value config for dashboard)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_settings_admin_all" ON public.system_settings;
CREATE POLICY "system_settings_admin_all" ON public.system_settings FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "system_settings_service_read" ON public.system_settings;
CREATE POLICY "system_settings_service_read" ON public.system_settings FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "system_settings_gate_public_read" ON public.system_settings;
CREATE POLICY "system_settings_gate_public_read" ON public.system_settings FOR SELECT
  USING (key IN ('login_gate_enabled', 'login_gate_key_hash'));

INSERT INTO public.system_settings (key, value) VALUES
  ('memory_inject_limit_channel', '25'),
  ('memory_inject_limit_global', '25'),
  ('login_gate_enabled', 'false'),
  ('login_gate_key_hash', '')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 15. html_previews (public HTML preview storage for coding module)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.html_previews (
  id          text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  html        text NOT NULL,
  title       text NOT NULL DEFAULT 'Untitled',
  agent_id    uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);
ALTER TABLE public.html_previews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "html_previews_admin_all" ON public.html_previews;
CREATE POLICY "html_previews_admin_all" ON public.html_previews FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "html_previews_service_all" ON public.html_previews;
CREATE POLICY "html_previews_service_all" ON public.html_previews FOR ALL
  USING (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS "html_previews_anon_select" ON public.html_previews;
CREATE POLICY "html_previews_anon_select" ON public.html_previews FOR SELECT
  USING (true);

-- ============================================================
-- 16. models
-- ============================================================
CREATE TABLE IF NOT EXISTS public.models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    text NOT NULL,
  label       text NOT NULL,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  is_builtin  boolean NOT NULL DEFAULT false,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_id, provider_id)
);
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "models_admin_all" ON public.models;
CREATE POLICY "models_admin_all" ON public.models FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "models_service_select" ON public.models;
CREATE POLICY "models_service_select" ON public.models FOR SELECT
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- ============================================================
-- 19. api_usage_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  provider_id     uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  model_id        text NOT NULL,
  input_tokens    int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  duration_ms     int,
  key_id          uuid REFERENCES public.provider_api_keys(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_logs_created ON public.api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS api_usage_logs_agent ON public.api_usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS api_usage_logs_key ON public.api_usage_logs(key_id);
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_usage_logs_admin_all" ON public.api_usage_logs;
CREATE POLICY "api_usage_logs_admin_all" ON public.api_usage_logs FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "api_usage_logs_service_all" ON public.api_usage_logs;
CREATE POLICY "api_usage_logs_service_all" ON public.api_usage_logs FOR ALL
  USING (public.is_admin() OR current_setting('role') = 'service_role');

-- RPC: hourly usage stats aggregation
CREATE OR REPLACE FUNCTION public.hourly_usage_stats(hours_back int DEFAULT 24)
RETURNS TABLE (
  hour timestamptz,
  model_id text,
  call_count bigint,
  avg_duration_ms numeric,
  total_input_tokens bigint,
  total_output_tokens bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    date_trunc('hour', created_at) AS hour,
    model_id,
    count(*)::bigint AS call_count,
    round(avg(duration_ms)::numeric, 0) AS avg_duration_ms,
    sum(input_tokens)::bigint AS total_input_tokens,
    sum(output_tokens)::bigint AS total_output_tokens
  FROM public.api_usage_logs
  WHERE created_at >= now() - (hours_back || ' hours')::interval
  GROUP BY date_trunc('hour', created_at), model_id
  ORDER BY hour ASC, model_id ASC;
$fn$;

-- RPC: per-key usage stats (1h / 24h)
CREATE OR REPLACE FUNCTION public.key_usage_stats(target_provider_id uuid)
RETURNS TABLE (
  key_id uuid,
  calls_1h bigint,
  calls_24h bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    k.id AS key_id,
    count(*) FILTER (WHERE l.created_at >= now() - interval '1 hour')::bigint AS calls_1h,
    count(*) FILTER (WHERE l.created_at >= now() - interval '24 hours')::bigint AS calls_24h
  FROM public.provider_api_keys k
  LEFT JOIN public.api_usage_logs l ON l.key_id = k.id AND l.created_at >= now() - interval '24 hours'
  WHERE k.provider_id = target_provider_id
  GROUP BY k.id;
$fn$;

-- Seed built-in providers (fixed UUIDs for idempotency)
INSERT INTO public.providers (id, name, type, base_url, is_builtin, enabled) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Anthropic', 'anthropic', NULL, true, true),
  ('00000000-0000-0000-0000-000000000002', 'OpenAI', 'openai', NULL, true, true),
  ('00000000-0000-0000-0000-000000000003', 'Google', 'google', NULL, true, true),
  ('00000000-0000-0000-0000-000000000004', 'DeepSeek', 'deepseek', 'https://api.deepseek.com', true, true)
ON CONFLICT (id) DO NOTHING;

-- Seed built-in models
INSERT INTO public.models (model_id, label, provider_id, is_builtin) VALUES
  ('claude-opus-4-6', 'Claude Opus 4.6', '00000000-0000-0000-0000-000000000001', true),
  ('claude-sonnet-4-6', 'Claude Sonnet 4.6', '00000000-0000-0000-0000-000000000001', true),
  ('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', '00000000-0000-0000-0000-000000000001', true),
  ('claude-sonnet-4-20250514', 'Claude Sonnet 4', '00000000-0000-0000-0000-000000000001', true),
  ('gpt-5.4', 'GPT-5.4', '00000000-0000-0000-0000-000000000002', true),
  ('gpt-5-mini', 'GPT-5 Mini', '00000000-0000-0000-0000-000000000002', true),
  ('gpt-5-nano', 'GPT-5 Nano', '00000000-0000-0000-0000-000000000002', true),
  ('gpt-4.1', 'GPT-4.1', '00000000-0000-0000-0000-000000000002', true),
  ('gpt-4.1-mini', 'GPT-4.1 Mini', '00000000-0000-0000-0000-000000000002', true),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', '00000000-0000-0000-0000-000000000003', true),
  ('gemini-3-flash-preview', 'Gemini 3 Flash', '00000000-0000-0000-0000-000000000003', true),
  ('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite', '00000000-0000-0000-0000-000000000003', true),
  ('gemini-2.5-pro', 'Gemini 2.5 Pro', '00000000-0000-0000-0000-000000000003', true),
  ('gemini-2.5-flash', 'Gemini 2.5 Flash', '00000000-0000-0000-0000-000000000003', true),
  ('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', '00000000-0000-0000-0000-000000000003', true),
  ('deepseek-chat', 'DeepSeek Chat', '00000000-0000-0000-0000-000000000004', true),
  ('deepseek-reasoner', 'DeepSeek Reasoner', '00000000-0000-0000-0000-000000000004', true)
ON CONFLICT (model_id, provider_id) DO NOTHING;

-- Ensure Supabase API roles can reach schema objects (RLS still applies row-level checks)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.events TO anon;
GRANT SELECT ON public.html_previews TO anon;
GRANT ALL ON public.providers TO service_role, authenticated;
GRANT ALL ON public.provider_api_keys TO service_role, authenticated;
GRANT ALL ON public.models TO service_role, authenticated;
GRANT ALL ON public.api_usage_logs TO service_role, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ============================================================
-- Triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS secrets_updated_at ON public.secrets;
CREATE TRIGGER secrets_updated_at BEFORE UPDATE ON public.secrets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS sessions_updated_at ON public.sessions;
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS channels_updated_at ON public.channels;
CREATE TRIGGER channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
