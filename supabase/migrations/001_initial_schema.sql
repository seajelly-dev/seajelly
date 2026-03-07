-- OpenCrab Initial Schema
-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- 1. admins
-- ============================================================
create table public.admins (
  id            uuid primary key default gen_random_uuid(),
  auth_uid      uuid unique not null,
  email         text unique not null,
  is_super_admin boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.admins enable row level security;

create policy "admins_select_self" on public.admins
  for select using (auth.uid() = auth_uid);

create policy "admins_insert_first" on public.admins
  for insert with check (
    (select count(*) from public.admins) = 0
    or auth.uid() in (select auth_uid from public.admins where is_super_admin = true)
  );

-- ============================================================
-- 2. secrets
-- ============================================================
create table public.secrets (
  id              uuid primary key default gen_random_uuid(),
  key_name        text unique not null,
  encrypted_value text not null,
  created_by      uuid references public.admins(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.secrets enable row level security;

create policy "secrets_admin_all" on public.secrets
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

-- ============================================================
-- 3. agents
-- ============================================================
create table public.agents (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  system_prompt     text not null default '',
  tools_config      jsonb not null default '{}',
  memory_namespace  text not null default 'default',
  model             text not null default 'claude-sonnet-4-20250514',
  is_default        boolean not null default false,
  created_at        timestamptz not null default now()
);

alter table public.agents enable row level security;

create policy "agents_admin_all" on public.agents
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

-- allow service-role / anon to read agents for webhook processing
create policy "agents_public_select" on public.agents
  for select using (true);

-- ============================================================
-- 4. sessions
-- ============================================================
create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  agent_id    uuid not null references public.agents(id) on delete cascade,
  messages    jsonb not null default '[]',
  metadata    jsonb not null default '{}',
  version     int not null default 1,
  updated_at  timestamptz not null default now()
);

create unique index sessions_chat_agent on public.sessions(chat_id, agent_id);
create index sessions_chat_id on public.sessions(chat_id);

alter table public.sessions enable row level security;

create policy "sessions_admin_all" on public.sessions
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "sessions_public_select" on public.sessions
  for select using (true);

create policy "sessions_service_upsert" on public.sessions
  for insert with check (true);

create policy "sessions_service_update" on public.sessions
  for update using (true);

-- ============================================================
-- 5. memories
-- ============================================================
create table public.memories (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  namespace   text not null default 'default',
  category    text not null check (category in ('fact', 'preference', 'decision', 'summary', 'other')),
  content     text not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index memories_agent_ns on public.memories(agent_id, namespace);

alter table public.memories enable row level security;

create policy "memories_admin_all" on public.memories
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "memories_public_rw" on public.memories
  for all using (true);

-- ============================================================
-- 6. memory_chunks
-- ============================================================
create table public.memory_chunks (
  id            uuid primary key default gen_random_uuid(),
  memory_id     uuid not null references public.memories(id) on delete cascade,
  chunk_text    text not null,
  embedding     vector(768),
  content_hash  text not null,
  embed_model   text,
  status        text not null default 'pending_embedded' check (status in ('pending_embedded', 'embedded', 'embed_failed')),
  start_line    int,
  end_line      int,
  created_at    timestamptz not null default now()
);

create index memory_chunks_memory on public.memory_chunks(memory_id);
create index memory_chunks_hash on public.memory_chunks(content_hash);

alter table public.memory_chunks enable row level security;

create policy "memory_chunks_admin_all" on public.memory_chunks
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "memory_chunks_public_rw" on public.memory_chunks
  for all using (true);

-- ============================================================
-- 7. cron_jobs
-- ============================================================
create table public.cron_jobs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  schedule      text not null,
  task_type     text not null,
  task_config   jsonb not null default '{}',
  enabled       boolean not null default true,
  last_run      timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.cron_jobs enable row level security;

create policy "cron_jobs_admin_all" on public.cron_jobs
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

-- ============================================================
-- 8. events
-- ============================================================
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('telegram', 'cron', 'webhook', 'manual')),
  agent_id        uuid references public.agents(id) on delete set null,
  chat_id         bigint,
  dedup_key       text unique,
  payload         jsonb not null default '{}',
  status          text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed', 'dead')),
  locked_until    timestamptz,
  retry_count     int not null default 0,
  max_retries     int not null default 5,
  error_message   text,
  trace_id        text not null default gen_random_uuid()::text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

create index events_status_created on public.events(status, created_at);
create index events_dedup on public.events(dedup_key);
create index events_trace on public.events(trace_id);

alter table public.events enable row level security;

create policy "events_admin_all" on public.events
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "events_public_rw" on public.events
  for all using (true);

-- ============================================================
-- 9. skills
-- ============================================================
create table public.skills (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text not null default '',
  content     text not null,
  tool_schema jsonb,
  source_url  text,
  created_at  timestamptz not null default now()
);

alter table public.skills enable row level security;

create policy "skills_admin_all" on public.skills
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "skills_public_select" on public.skills
  for select using (true);

-- ============================================================
-- 10. agent_skills (many-to-many)
-- ============================================================
create table public.agent_skills (
  agent_id  uuid not null references public.agents(id) on delete cascade,
  skill_id  uuid not null references public.skills(id) on delete cascade,
  primary key (agent_id, skill_id)
);

alter table public.agent_skills enable row level security;

create policy "agent_skills_admin_all" on public.agent_skills
  for all using (
    auth.uid() in (select auth_uid from public.admins)
  );

create policy "agent_skills_public_select" on public.agent_skills
  for select using (true);

-- ============================================================
-- Helper function: update updated_at on row change
-- ============================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger secrets_updated_at before update on public.secrets
  for each row execute function public.update_updated_at();

create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.update_updated_at();
