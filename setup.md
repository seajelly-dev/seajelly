# SEAJelly Setup Guide

Beginner-friendly setup walkthrough for first-time users.

Official domain: [seajelly.ai](https://seajelly.ai)

> 中文版: [setup.zh-CN.md](./setup.zh-CN.md)

## Before You Start

Prepare these first:

| Item | Required | Notes |
| --- | --- | --- |
| Supabase account and project | Yes | Used for Auth, Postgres, pgvector, and scheduling |
| Vercel account and deployment | Yes | Recommended production host |
| Public app URL | Yes | Needed for setup, webhooks, previews, voice links, and cron callbacks |
| At least one LLM API key | Yes | Setup requires at least one provider key |
| GitHub fine-grained PAT | Optional | Needed later for self-evolution and guided one-click updates |
| Vercel token and project ID | Optional | Needed later to monitor deployments after GitHub pushes |
| IM platform credentials | Optional | You can skip this during setup and add them later |

If you have not deployed yet, the fastest route is the Vercel button in [README.md](./README.md).

That install button should point to the `stable` branch so first-time users always install the latest formal release, not an in-between development snapshot from `main`.

## Bootstrap Environment Variables

Before opening `/setup`, make sure your deployment has:

| Variable | Why it matters |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Connects the app to your Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and session-auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | Must already exist in Vercel before `/setup` can continue |
| `ENCRYPTION_KEY` | Encrypts stored secrets |
| `NEXT_PUBLIC_APP_URL` | Public base URL for redirects, webhooks, previews, and cron |
| `CRON_SECRET` | Protects worker endpoints |

Generate `ENCRYPTION_KEY` and `CRON_SECRET` with:

```bash
openssl rand -base64 32
```

SEAJelly now validates these deployment variables in step 1 before it runs any setup SQL. If something is wrong, `/setup` will block and tell you to fix the value in Vercel and redeploy first.

Common mistakes:

- `NEXT_PUBLIC_APP_URL` is missing `https://`
- `NEXT_PUBLIC_APP_URL` contains a path instead of just the site origin
- `ENCRYPTION_KEY` is not a valid 32-byte base64 key
- `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` was added after deployment, but the app was not redeployed

## Step 1: Connect Supabase

Open `/setup`. The first step asks for:

- `Supabase Access Token (PAT)`
- `Project Ref`

### Where to get them

- PAT: Supabase dashboard -> avatar -> `Account` -> `Access Tokens`
- Project Ref: the `<ref>` part of `https://<ref>.supabase.co`

### What happens when you click Connect

SEAJelly will:

- verify it can reach your project
- create the required tables and functions
- enable the required extensions
- save your Supabase bootstrap credentials securely

You do not need to run SQL manually for the normal setup path.

SEAJelly now keeps your PAT and project ref in a temporary HttpOnly setup cookie, so refreshing in the same browser can resume the setup flow safely until setup finishes.

## Step 2: Create the First Admin

Enter:

- email
- password
- password confirmation

This account becomes the first dashboard admin. Use a real email you control and a password you will remember.

Important:

- If Supabase Auth still has `Confirm email` enabled, or the Auth URL Configuration is wrong, setup will now roll back the partial admin account instead of leaving you in a half-broken state.
- If setup detects that an admin already exists but this browser is not signed in, step 2 will offer a reset action that clears the unfinished setup data so you can start over cleanly.

## Step 3: Save Required Keys

This step requires:

- at least one LLM provider API key
- optional embedding credentials if you want them immediately

The built-in setup form currently accepts provider keys for:

- Anthropic
- OpenAI
- Google
- DeepSeek

Notes:

- You only need one provider key to finish setup.
- You can add more providers and models later in the dashboard.
- `SUPABASE_SERVICE_ROLE_KEY` is now treated as a deployment prerequisite, not something you paste into the setup form.

## Step 4: Create the First Agent

This step creates your first working SEAJelly agent.

### Required fields

- `Agent Name`
- `Model`
- `System Prompt`

### Optional platform setup

You can also connect an IM platform now, or skip it and configure it later.

Current setup options include:

- Telegram
- Feishu
- WeCom
- Slack
- QQ Bot
- WhatsApp
- Skip for now

If you are unsure, skip the platform step and finish the dashboard first.

### Platform notes

- Telegram: requires a Bot Token from `@BotFather`
- Feishu / WeCom / Slack / QQ Bot / WhatsApp: setup can save the core credentials, but you may still want to verify webhook settings afterward
- Some platforms use generated verification tokens; setup can help create them

## Important Production Note: Save The Security Login URL

At the end of setup, production deployments show a dedicated **security login URL** confirmation dialog.

Save it immediately and click the confirmation button only after you have copied it somewhere safe.

Why it matters:

- production login gate can be enabled automatically
- the generated login URL is the easiest way to reach the login page safely
- if you lose it before entering the dashboard, recovery is more annoying

Right after you confirm that dialog, SEAJelly now shows a second completion dialog with two choices:

- `Go to Dashboard`
- `Enable One-Click Updates`

If this install is several formal releases behind later on, `Dashboard -> Updates` now catches it up one official release hop at a time instead of trying to apply a risky cross-version patch in one jump.

## After Setup

Once setup finishes:

1. open the dashboard
2. or jump straight to `Dashboard -> Updates` if you want to enable guided one-click upgrades
3. confirm your first agent exists
4. test the agent on your chosen channel, or finish platform setup later
5. add knowledge bases, skills, MCP servers, and multimodal settings
6. explore the self-evolution workflow when you are ready

Useful next reads:

- [README.md](./README.md)
- [skills/self-evolution-guide/SKILL.md](./skills/self-evolution-guide/SKILL.md)
- [src/lib/agent/README.md](./src/lib/agent/README.md)

## Optional: Enable Self-Evolution And Guided Updates

When you are ready, open `Dashboard -> Coding` and configure GitHub plus Vercel.

### GitHub

- Prefer a **fine-grained PAT**
- `Resource owner`: choose the user or organization that owns the deployed repository
- `Repository access`: prefer `Only select repositories` and choose the deployed repository
- `Repository permissions`:
  - `Contents` -> `Read and write`
  - `Workflows` -> `Read and write`
- If the repository belongs to an organization, the token may remain `pending` until an org admin approves it

Official reference:

- [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2026-03-10)

### Vercel

- `Vercel Token`: avatar -> `Settings` -> `Tokens`, or [vercel.com/account/settings](https://vercel.com/account/settings)
- `Project ID`: open the project -> `Settings` -> `General` -> `Project ID`

These two values let SEAJelly monitor Vercel builds after GitHub pushes code during self-evolution or one-click updates.

## Common Problems

### Setup says connection failed

Double-check:

- your Supabase PAT
- your project ref
- your deployment can reach Supabase

### No models appear in the final step

Go back to step 3 and make sure at least one provider key was saved successfully.

### Telegram bot does not respond after setup

Check:

- the bot token is correct
- `NEXT_PUBLIC_APP_URL` matches your real public domain
- the agent exists in the dashboard
- webhook status and event logs in the dashboard

### Login page is hard to reopen in production

Use the saved security login URL from the final setup step.
