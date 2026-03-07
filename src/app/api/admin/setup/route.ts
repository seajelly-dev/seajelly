import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto/encrypt";

const MGMT_BASE = "https://api.supabase.com/v1";

// ─── GET: check setup status ───

export async function GET() {
  let db;
  try {
    db = await createAdminClient();
  } catch {
    db = await createClient();
  }

  const [admins, secrets, agents] = await Promise.all([
    db.from("admins").select("*", { count: "exact", head: true }),
    db.from("secrets").select("key_name"),
    db.from("agents").select("*", { count: "exact", head: true }),
  ]);

  const hasAdmin = (admins.count ?? 0) > 0;
  const secretKeys = (secrets.data ?? []).map((s) => s.key_name);
  const hasSupabaseKeys =
    secretKeys.includes("SUPABASE_ACCESS_TOKEN") &&
    secretKeys.includes("SUPABASE_PROJECT_REF");
  const hasServiceRole = secretKeys.includes("SUPABASE_SERVICE_ROLE_KEY");
  const hasLLMKey = secretKeys.some((k) =>
    [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "DEEPSEEK_API_KEY",
    ].includes(k)
  );
  const hasAgent = (agents.count ?? 0) > 0;

  const setupComplete =
    hasSupabaseKeys && hasAdmin && hasServiceRole && hasLLMKey && hasAgent;

  let currentStep = 0;
  if (hasSupabaseKeys) currentStep = 1;
  if (hasSupabaseKeys && hasAdmin) currentStep = 2;
  if (hasSupabaseKeys && hasAdmin && hasServiceRole && hasLLMKey)
    currentStep = 3;
  if (setupComplete) currentStep = 4;

  return NextResponse.json({
    needsSetup: !setupComplete,
    setupComplete,
    currentStep,
    hasSupabaseKeys,
    hasAdmin,
    hasServiceRole,
    hasLLMKey,
    hasAgent,
    configuredKeys: secretKeys,
  });
}

// ─── POST: handle each setup step ───

export async function POST(request: Request) {
  const body = await request.json();
  const { step } = body;

  if (step === "connect") return handleConnect(body);
  if (step === "register") return handleRegister(body);
  if (step === "secrets") return handleSecrets(body);
  if (step === "agent") return handleAgent(body);

  return NextResponse.json({ error: "Invalid step" }, { status: 400 });
}

// ─── Step 0: Connect Supabase + run migrations ───

async function handleConnect(body: {
  access_token: string;
  project_ref: string;
}) {
  const { access_token, project_ref } = body;
  if (!access_token || !project_ref) {
    return NextResponse.json(
      { error: "access_token and project_ref are required" },
      { status: 400 }
    );
  }

  async function execSQL(sql: string) {
    const res = await fetch(
      `${MGMT_BASE}/projects/${project_ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SQL execution failed (HTTP ${res.status}): ${text}`);
    }
    return res.json();
  }

  try {
    // Verify connection with a simple query
    await execSQL("SELECT 1 AS ok;");

    // Run the full schema (idempotent — uses IF NOT EXISTS everywhere)
    await execSQL(SCHEMA_SQL);

    // Enable scheduling extensions
    await execSQL(
      "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;"
    );
    await execSQL(
      "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;"
    );

    // Now that secrets table exists, store PAT + ref via Supabase Data API

    // Use upsert via anon key — secrets table has public RLS for this bootstrap
    // We need a temporary permissive approach: the SCHEMA_SQL creates the table
    // with admin-only policy, but we haven't registered an admin yet.
    // Solution: use Management API to insert directly.
    await execSQL(`
      INSERT INTO public.secrets (key_name, encrypted_value)
      VALUES
        ('SUPABASE_ACCESS_TOKEN', '${encrypt(access_token).replace(/'/g, "''")}'),
        ('SUPABASE_PROJECT_REF', '${encrypt(project_ref).replace(/'/g, "''")}')
      ON CONFLICT (key_name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = now();
    `);

    return NextResponse.json({
      success: true,
      message: "Database initialized, extensions enabled, credentials saved",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Connection failed" },
      { status: 500 }
    );
  }
}

// ─── Step 1: Register admin ───
// Front-end passes PAT + ref (cached from Step 0) to bypass RLS bootstrap issue

async function handleRegister(body: {
  email: string;
  password: string;
  access_token: string;
  project_ref: string;
}) {
  const { email, password, access_token, project_ref } = body;
  if (!access_token || !project_ref) {
    return NextResponse.json(
      { error: "Missing Supabase credentials — please redo Step 0" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  async function execSQL(sql: string) {
    const res = await fetch(
      `${MGMT_BASE}/projects/${project_ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SQL failed (HTTP ${res.status}): ${text}`);
    }
    return res.json();
  }

  try {
    const countResult = await execSQL(
      "SELECT count(*)::int AS cnt FROM public.admins;"
    );
    const adminCount =
      Array.isArray(countResult) && countResult[0]?.cnt
        ? Number(countResult[0].cnt)
        : 0;

    if (adminCount > 0) {
      return NextResponse.json(
        { error: "Admin already registered" },
        { status: 403 }
      );
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || "Registration failed" },
        { status: 400 }
      );
    }

    // Auto-confirm the user's email via Management API so auth.uid() works in RLS
    const confirmRes = await fetch(
      `${MGMT_BASE}/projects/${project_ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `UPDATE auth.users SET email_confirmed_at = now(), confirmed_at = now() WHERE id = '${authData.user.id}';`,
        }),
      }
    );
    if (!confirmRes.ok) {
      console.warn("Failed to auto-confirm user email:", await confirmRes.text());
    }

    const escapedEmail = email.replace(/'/g, "''");
    await execSQL(`
      INSERT INTO public.admins (auth_uid, email, is_super_admin)
      VALUES ('${authData.user.id}', '${escapedEmail}', true);
    `);

    // Sign in immediately so the session cookie is set with a confirmed user
    await supabase.auth.signInWithPassword({ email, password });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Registration failed" },
      { status: 500 }
    );
  }
}

// ─── Step 2: Save API keys ───
// Uses Management API to bypass RLS (user may not have confirmed email yet)

async function handleSecrets(body: {
  secrets: Record<string, string>;
  access_token: string;
  project_ref: string;
}) {
  const { access_token, project_ref } = body;
  if (!access_token || !project_ref) {
    return NextResponse.json(
      { error: "Missing Supabase credentials — please redo Step 0" },
      { status: 400 }
    );
  }

  async function execSQL(sql: string) {
    const res = await fetch(
      `${MGMT_BASE}/projects/${project_ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SQL failed (HTTP ${res.status}): ${text}`);
    }
    return res.json();
  }

  try {
    const entries = Object.entries(body.secrets).filter(
      ([, value]) => value && value.trim() !== ""
    );

    for (const [keyName, value] of entries) {
      const encryptedValue = encrypt(value).replace(/'/g, "''");
      const escapedKey = keyName.replace(/'/g, "''");
      await execSQL(`
        INSERT INTO public.secrets (key_name, encrypted_value)
        VALUES ('${escapedKey}', '${encryptedValue}')
        ON CONFLICT (key_name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = now();
      `);
    }

    return NextResponse.json({ success: true, count: entries.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save secrets" },
      { status: 500 }
    );
  }
}

// ─── Step 3: Create first agent ───
// Uses Management API to bypass RLS

async function handleAgent(body: {
  name: string;
  system_prompt: string;
  model: string;
  telegram_bot_token?: string;
  access_token: string;
  project_ref: string;
}) {
  const { access_token, project_ref } = body;
  if (!access_token || !project_ref) {
    return NextResponse.json(
      { error: "Missing Supabase credentials — please redo Step 0" },
      { status: 400 }
    );
  }

  try {
    const escapedName = body.name.replace(/'/g, "''");
    const escapedPrompt = body.system_prompt.replace(/'/g, "''");
    const escapedModel = body.model.replace(/'/g, "''");
    const tokenValue = body.telegram_bot_token
      ? `'${encrypt(body.telegram_bot_token).replace(/'/g, "''")}'`
      : "NULL";

    const res = await fetch(
      `${MGMT_BASE}/projects/${project_ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            INSERT INTO public.agents (name, system_prompt, model, is_default, telegram_bot_token)
            VALUES ('${escapedName}', '${escapedPrompt}', '${escapedModel}', true, ${tokenValue})
            RETURNING id, name;
          `,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create agent (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json();
    const agentId = data?.[0]?.id;

    if (agentId && body.telegram_bot_token) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (appUrl) {
        try {
          const { getBotForAgent, resetBotForAgent } = await import("@/lib/telegram/bot");
          const { BOT_COMMANDS } = await import("@/lib/telegram/commands");
          resetBotForAgent(agentId);
          const bot = await getBotForAgent(agentId);
          await bot.api.setWebhook(`${appUrl}/api/webhook/telegram/${agentId}`);
          await bot.api.setMyCommands(BOT_COMMANDS);
        } catch (webhookErr) {
          console.warn("Auto-webhook setup failed (non-blocking):", webhookErr);
        }
      }
    }

    return NextResponse.json({ success: true, agent: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create agent" },
      { status: 500 }
    );
  }
}

// ─── Inline schema SQL (idempotent, no fs dependency) ───

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS public.admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid      uuid UNIQUE NOT NULL,
  email         text UNIQUE NOT NULL,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Security definer function: checks admin status bypassing RLS on admins table
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

CREATE TABLE IF NOT EXISTS public.agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  system_prompt     text NOT NULL DEFAULT '',
  tools_config      jsonb NOT NULL DEFAULT '{}',
  memory_namespace  text NOT NULL DEFAULT 'default',
  model             text NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  is_default        boolean NOT NULL DEFAULT false,
  access_mode       text NOT NULL DEFAULT 'open' CHECK (access_mode IN ('open','whitelist')),
  ai_soul           text NOT NULL DEFAULT '',
  telegram_bot_token text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_admin_all" ON public.agents;
CREATE POLICY "agents_admin_all" ON public.agents FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agents_public_select" ON public.agents;
CREATE POLICY "agents_public_select" ON public.agents FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('telegram','discord','slack','web')),
  platform_uid  text NOT NULL,
  display_name  text,
  user_soul     text NOT NULL DEFAULT '',
  is_allowed    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_agent_platform_uid ON public.channels(agent_id, platform, platform_uid);
CREATE INDEX IF NOT EXISTS channels_platform_uid ON public.channels(platform, platform_uid);
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channels_admin_all" ON public.channels;
CREATE POLICY "channels_admin_all" ON public.channels FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "channels_public_rw" ON public.channels;
CREATE POLICY "channels_public_rw" ON public.channels FOR ALL USING (true);

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
CREATE POLICY "sessions_public_select" ON public.sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS "sessions_service_upsert" ON public.sessions;
CREATE POLICY "sessions_service_upsert" ON public.sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sessions_service_update" ON public.sessions;
CREATE POLICY "sessions_service_update" ON public.sessions FOR UPDATE USING (true);

CREATE TABLE IF NOT EXISTS public.memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  namespace   text NOT NULL DEFAULT 'default',
  category    text NOT NULL CHECK (category IN ('fact','preference','decision','summary','other')),
  content     text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memories_agent_ns ON public.memories(agent_id, namespace);
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_admin_all" ON public.memories;
CREATE POLICY "memories_admin_all" ON public.memories FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "memories_public_rw" ON public.memories;
CREATE POLICY "memories_public_rw" ON public.memories FOR ALL USING (true);

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
CREATE POLICY "memory_chunks_public_rw" ON public.memory_chunks FOR ALL USING (true);

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
CREATE POLICY "events_public_rw" ON public.events FOR ALL USING (true);

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
CREATE POLICY "skills_public_select" ON public.skills FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.agent_skills (
  agent_id  uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  skill_id  uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_skills_admin_all" ON public.agent_skills;
CREATE POLICY "agent_skills_admin_all" ON public.agent_skills FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agent_skills_public_select" ON public.agent_skills;
CREATE POLICY "agent_skills_public_select" ON public.agent_skills FOR SELECT USING (true);

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
CREATE POLICY "mcp_servers_public_select" ON public.mcp_servers FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.agent_mcps (
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  mcp_server_id uuid NOT NULL REFERENCES public.mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, mcp_server_id)
);
ALTER TABLE public.agent_mcps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_mcps_admin_all" ON public.agent_mcps;
CREATE POLICY "agent_mcps_admin_all" ON public.agent_mcps FOR ALL USING (public.is_admin());
DROP POLICY IF EXISTS "agent_mcps_public_select" ON public.agent_mcps;
CREATE POLICY "agent_mcps_public_select" ON public.agent_mcps FOR SELECT USING (true);

-- Ensure Supabase API roles can reach schema objects (RLS still applies row-level checks)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

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
`;
