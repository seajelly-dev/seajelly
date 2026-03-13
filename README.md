# SEAJelly 🪼

**Self Evolution Agent** — Get your own cloud AI Agent in 5 minutes. Powered by [seaJelly.ai](https://seajelly.ai).

No server. No Docker. No SSH. Just Supabase + Vercel free tier.

> 🇨🇳 [中文文档](./README.zh-CN.md)

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Register Services](#step-1-register-services)
- [Step 2: Deploy to Vercel](#step-2-deploy-to-vercel)
- [Step 3: Custom Domain](#step-3-custom-domain)
- [Step 4: Run Setup Wizard](#step-4-run-setup-wizard)
- [Step 5: Start Using](#step-5-start-using)
- [Local Development](#local-development)
- [Architecture](#architecture)
- [FAQ](#faq)

---

## Prerequisites

You'll need the following (all free):

| Item | Description |
|---|---|
| A custom domain | Chinese users **must** use a custom domain — `.vercel.app` is blocked in China |
| GitHub account | For forking the repo and Vercel deployment |

---

## Step 1: Register Services

### 1.1 Supabase (Database)

> Website: **https://supabase.com**

1. Sign up (GitHub login supported)
2. Click **New Project**, choose free plan
3. Set project name and DB password (remember it)
4. Region: recommend **Southeast Asia (Singapore)**
5. Wait for project creation (~1-2 min)

**Info to note:**

| Info | Where to find |
|---|---|
| Project URL | Settings → API → Project URL (like `https://xxxxx.supabase.co`) |
| Anon Key | Settings → API → `anon` `public` (long string starting with `eyJ`) |
| Service Role Key | Settings → API → `service_role` `secret` (**Keep secret!**) |
| Project Ref | The part between `https://` and `.supabase.co` in your project URL |
| Access Token (PAT) | Click avatar (bottom-left) → Account → Access Tokens → **Generate new token** |

### 1.2 Vercel (Hosting)

> Website: **https://vercel.com**

1. Sign in with GitHub
2. That's it — deployment will link automatically later

### 1.3 LLM API Key (at least one)

SEAJelly supports multiple LLM providers. You need **at least one** API Key:

| Provider | Sign Up | Key Location | Why |
|---|---|---|---|
| **Google Gemini** ⭐ | https://aistudio.google.com/apikey | Generate directly on page | **Best free tier, recommended for beginners** |
| Anthropic (Claude) | https://console.anthropic.com | Settings → API Keys | Best reasoning |
| OpenAI (GPT) | https://platform.openai.com/api-keys | Create on page | Largest ecosystem |
| DeepSeek | https://platform.deepseek.com/api_keys | Create on page | Best value |

> 💡 **Recommendation**: Start with Google Gemini — the free tier is generous enough for daily use.

### 1.4 Telegram Bot Token (optional)

> Search **@BotFather** in Telegram

1. Send `/newbot`
2. Follow prompts to set name and username
3. Get a token like `123456789:ABCdef...`

> Can also be configured later after Setup.

---

## Step 2: Deploy to Vercel

### 2.1 Fork the Repository

1. Open this project's GitHub page
2. Click **Fork** in the top right
3. Fork to your own GitHub account

### 2.2 Import in Vercel

1. Go to https://vercel.com/new
2. Select the forked `seajelly` repo
3. Add these **Environment Variables**:

| Variable | Value | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` | Supabase Anon Key |
| `ENCRYPTION_KEY` | *(generate, see below)* | Encryption key |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.com` | Your custom domain (**critical!**) |
| `CRON_SECRET` | *(generate, see below)* | Cron job secret |

**Generate ENCRYPTION_KEY and CRON_SECRET:**

Run in terminal (twice, one for each):

```bash
openssl rand -base64 32
```

Or in browser console:

```javascript
crypto.getRandomValues(new Uint8Array(32)).reduce((a,b) => a + b.toString(16).padStart(2,'0'), '')
```

4. Click **Deploy** and wait

---

## Step 3: Custom Domain

> ⚠️ `.vercel.app` domains are blocked in mainland China. You **must** bind a custom domain.

1. In Vercel project, go to **Settings → Domains**
2. Enter your domain (e.g. `oc.yourdomain.com`)
3. Add a CNAME record at your DNS provider:
   - Type: `CNAME`
   - Name: `oc` (or your chosen subdomain)
   - Value: `cname.vercel-dns.com`
4. Wait for DNS propagation (minutes to hours)
5. **Important**: Go back to Vercel → Settings → Environment Variables, confirm `NEXT_PUBLIC_APP_URL` matches your custom domain

---

## Step 4: Run Setup Wizard

Open in browser:

```
https://yourdomain.com/setup
```

### Step 1 of 4: Connect Supabase

| Field | What to fill |
|---|---|
| Supabase Access Token (PAT) | The Access Token from [1.1](#11-supabase-database) |
| Project Ref | The middle part of your project URL (e.g. `gjtcqawhjgaohawslmbs`) |

> Click "Connect & Initialize" — all tables and extensions are created automatically. **No manual SQL needed.**

### Step 2 of 4: Create Admin

Enter email and password (min 6 chars). This is your Dashboard login.

### Step 3 of 4: Configure API Keys

| Field | Required | Description |
|---|---|---|
| Supabase Service Role Key | ✅ Yes | Settings → API → `service_role` |
| Anthropic API Key | At least | Claude models |
| OpenAI API Key | one LLM | GPT models |
| Google AI API Key | key | Gemini models ⭐ Recommended |
| DeepSeek API Key | | DeepSeek models |

### Step 4 of 4: Create Agent

| Field | Description |
|---|---|
| Agent Name | Your AI assistant's name |
| Telegram Bot Token | Optional, from @BotFather |
| Model | Auto-shows available models based on your keys |
| System Prompt | Has a sensible default, fully customizable |

> 💡 If you provide a Telegram Bot Token, the Webhook is **set automatically** — no extra steps needed.

---

## Step 5: Start Using

### Dashboard

After Setup you'll be redirected to Dashboard (`https://yourdomain.com/dashboard`).

| Module | Function |
|---|---|
| **Agents** | Manage AI assistants: model, prompt, Bot Token, Webhook status |
| **Channels** | Manage user access and identity profiles |
| **Secrets** | Manage encrypted API keys |
| **Sessions** | View conversation history |
| **Tasks** | Manage scheduled cron jobs |
| **MCP Servers** | Connect external MCP tool services |
| **Skills** | Manage agent knowledge skills |
| **Events** | Event queue debug panel |

### Telegram Bot

If you configured a Bot Token in Setup:

1. Find your bot in Telegram
2. Send `/start` to begin
3. Just send messages to chat

**Available commands:**

| Command | Function |
|---|---|
| `/new` | Start new session (clear history) |
| `/status` | Show agent and session status |
| `/whoami` | Show your identity profile |
| `/help` | Show command list |

### Verify Webhook

On Dashboard → Agents page, each Agent card with a Bot Token shows Webhook status:

- ✅ **Green "Webhook Active"** — all good
- ⚠️ **Orange "Webhook Not Set"** — click "Set Webhook" button

---

## Local Development

```bash
git clone https://github.com/your-username/seajelly.git
cd seajelly
pnpm install

cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Generate encryption key
openssl rand -base64 32
# Add to .env.local as ENCRYPTION_KEY

# Start dev server (http://localhost:3000)
pnpm dev
```

---

## Architecture

```
User
  │
  ├── Telegram ──→ Webhook ──→ events table ──→ Agent Loop ──→ Reply
  │                                 ↑
  │                           after() triggers
  │                           worker processing
  │
  └── Dashboard ──→ Next.js App ──→ Supabase (RLS + Auth)
                                       │
                                       ├── agents      (AI config)
                                       ├── sessions    (chat history)
                                       ├── channels    (user profiles)
                                       ├── secrets     (encrypted keys)
                                       ├── events      (event queue)
                                       ├── memories    (long-term memory)
                                       ├── cron_jobs   (scheduled tasks)
                                       ├── mcp_servers (MCP tools)
                                       └── skills      (knowledge skills)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + shadcn/ui + Tailwind CSS |
| AI Engine | Vercel AI SDK (`generateText` + tools) |
| Telegram | grammY (Webhook) |
| Database | Supabase PostgreSQL + pgvector |
| Auth | Supabase Auth + Row Level Security |
| Scheduling | pg_cron + pg_net |
| Hosting | Vercel Serverless Functions |

## Supported Models

| Provider | Models |
|---|---|
| Anthropic | Claude Sonnet 4, Claude 3.5 Haiku |
| OpenAI | GPT-4o, GPT-4o Mini, o3-mini |
| Google | Gemini 3.1 Pro, Gemini 3/2.5 Flash, Gemini 2.5 Pro |
| DeepSeek | DeepSeek Chat, DeepSeek Reasoner |

---

## FAQ

### Q: Getting 404 or can't connect after deployment?

**A:** Chinese users must bind a custom domain. `.vercel.app` is blocked in China. See [Step 3](#step-3-custom-domain).

### Q: Setup Step 1 shows "Connection failed"?

**A:** Check your Supabase Access Token (PAT) and Project Ref. PAT is generated at Supabase → avatar (bottom-left) → Account → Access Tokens.

### Q: Telegram Bot not responding?

**A:** Check:
1. Dashboard → Agents — confirm Webhook status is green "Active"
2. If it shows "Not Set", click "Set Webhook"
3. Confirm `NEXT_PUBLIC_APP_URL` in Vercel env vars matches your custom domain
4. Check Dashboard → Events for pending events

### Q: Events stuck in pending?

**A:** Make sure Vercel is running the latest code. The webhook uses `after()` to automatically trigger the worker. Check Vercel Functions logs if issues persist.

### Q: Is the free tier enough?

**A:** Absolutely for personal use:
- **Supabase Free**: 500MB database, 5GB bandwidth
- **Vercel Hobby**: 100GB bandwidth, 100 hours/month serverless
- **Gemini Free**: 15 requests/min, 1500 requests/day

---

## License

MIT
