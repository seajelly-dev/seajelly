# OpenCrab 🦀

**Cloud-Native Personal AI Agent** — Let everyone have a cloud AI Agent in 5 minutes.

No server. No Docker. No SSH. Just Supabase + Vercel free tier.

## Deploy

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In **SQL Editor**, run the migration from `supabase/migrations/001_initial_schema.sql`
3. Note your **Project URL** and **Anon Key** from Settings → API

### 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/opencrab&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,ENCRYPTION_KEY&envDescription=Supabase%20URL%20and%20Anon%20Key%20from%20your%20project.%20ENCRYPTION_KEY%20is%20auto-generated.&project-name=opencrab)

You'll need to provide 3 environment variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (public, RLS-protected) |
| `ENCRYPTION_KEY` | Run `openssl rand -base64 32` to generate |

### 3. First-Time Setup

1. Visit `https://your-app.vercel.app/setup`
2. **Step 1**: Create your admin account
3. **Step 2**: Configure API keys (Supabase Service Role Key, LLM API Key, Telegram Bot Token)
4. **Step 3**: Create your first AI agent

### 4. Set Telegram Webhook

In the Dashboard, go to the Telegram settings to set the webhook URL:

```
https://your-app.vercel.app/api/webhook/telegram
```

### 5. Set Up Event Processing

In Supabase SQL Editor, create a pg_cron job to process events:

```sql
select cron.schedule(
  'process-events',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://your-app.vercel.app/api/worker/process',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);
```

## Local Development

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Generate encryption key
openssl rand -base64 32
# Add to .env.local as ENCRYPTION_KEY

# Start dev server (Web UI on http://localhost:3000)
pnpm dev
```

### Telegram Bot (Local)

Local development doesn't need a public URL. A polling script connects directly to Telegram:

```bash
# Add your Supabase Service Role Key to .env.local
# (find it in Supabase Dashboard → Settings → API → service_role)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Start the bot in a separate terminal
pnpm run dev:bot
```

The polling script will:
- Read the Telegram Bot Token from the database (configured in Setup Wizard)
- Clear any existing webhook and start long polling
- Process messages through the full Agentic Loop (LLM + tools + memory)
- Reply directly in Telegram

Run `pnpm dev` and `pnpm dev:bot` side by side — Web UI and Telegram Bot work simultaneously.

## Architecture

```
Telegram → Webhook Handler → events table (pending)
                                    ↓
              pg_cron → Worker Endpoint → Agentic Loop
                                    ↓
                          LLM API (Claude/GPT/Gemini)
                                    ↓
                          Reply → Telegram
```

- **Webhook only enqueues** — fast 200 OK, no processing in the webhook handler
- **Worker consumes events** — triggered by pg_cron every 5 seconds
- **Agentic Loop** — Vercel AI SDK `generateText` with tools (memory_write, memory_search)
- **All secrets in DB** — encrypted with AES-256-GCM, configured via Web UI

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + shadcn/ui
- **AI Engine**: Vercel AI SDK
- **Telegram**: grammY (Webhook mode)
- **Database**: Supabase Postgres + pgvector
- **Auth**: Supabase Auth + RLS
- **Scheduling**: pg_cron + pg_net

## License

MIT
