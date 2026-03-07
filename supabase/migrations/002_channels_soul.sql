-- ============================================================
-- Migration 002: Channels + Soul + Gateway
-- ============================================================

-- 1. channels table — maps platform users to agents
create table public.channels (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  platform      text not null check (platform in ('telegram', 'discord', 'slack', 'web')),
  platform_uid  text not null,
  display_name  text,
  user_soul     text not null default '',
  is_allowed    boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index channels_agent_platform_uid on public.channels(agent_id, platform, platform_uid);
create index channels_platform_uid on public.channels(platform, platform_uid);

alter table public.channels enable row level security;

create policy "channels_admin_all" on public.channels
  for all using (auth.uid() in (select auth_uid from public.admins));

create policy "channels_public_rw" on public.channels
  for all using (true);

create trigger channels_updated_at before update on public.channels
  for each row execute function public.update_updated_at();

-- 2. agents: add access_mode + ai_soul
alter table public.agents
  add column access_mode text not null default 'open'
  check (access_mode in ('open', 'whitelist'));

alter table public.agents
  add column ai_soul text not null default '';

alter table public.agents
  add column telegram_bot_token text;

-- 3. sessions: add channel_id (nullable for backwards compat)
alter table public.sessions
  add column channel_id uuid references public.channels(id) on delete set null;

create index sessions_channel_id on public.sessions(channel_id);
