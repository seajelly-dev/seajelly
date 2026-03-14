# SEAJelly Agent Guide

## Product Name

- The project name is `SEAJelly`.
- `SEA` means `Self Evolution Agent`.
- `Jelly` matches the jellyfish/jelly mascot and the current brand identity.

## Project Snapshot

- Stack: Next.js App Router, React 19, TypeScript, Supabase, Vercel
- Shape: serverless multi-channel AI agent platform with an admin dashboard
- Major modules: self-evolution pipeline, agent runtime, webhook ingestion, async worker queue, knowledge base, skills, MCP, coding sandbox, multimodal voice, sub-apps, JellyBox storage, subscriptions

Primary runtime surfaces:

- `src/app/api/**`: API routes
- `src/lib/**`: business logic
- `supabase/migrations/**`: schema and RLS

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm test:unit
pnpm build
```

## Important Directories

- `src/app/(dashboard)`: authenticated dashboard pages
- `src/app/api/admin`: admin APIs
- `src/app/api/webhook`: channel webhook entrypoints
- `src/app/api/worker`: queue and scheduler workers
- `src/app/api/voice`: voice temp-link and config APIs
- `src/app/api/app`: public bearer-link sub-app APIs
- `src/lib/agent`: loop, commands, tools, media, runtime assembly
- `src/lib/agent/tooling`: builtin tool and toolkit policy
- `src/lib/platform`: sender adapters, approval flows, webhook helpers
- `src/lib/supabase`: auth/session helpers, admin/service clients, middleware
- `src/lib/security`: login gate and network/security utilities
- `supabase/migrations/001_initial_schema.sql`: schema source tracked in git
- `skills/self-evolution-guide/SKILL.md`: self-evolution workflow guide

## Durable Repo Rules

### 1. Auth and admin boundaries

- Global auth gating lives in `src/lib/supabase/middleware.ts`.
- The dashboard layout checks for a logged-in user, not admin role.
- Real admin authorization is `requireAdmin()` in `src/lib/supabase/server.ts`.
- Any `/api/admin/**` route that mutates or reads privileged data should explicitly call `requireAdmin()`.

### 2. Pick the right Supabase client

- `createClient()`: session-scoped SSR client, subject to RLS
- `createAdminClient()`: bypasses RLS, okay for trusted admin paths after `requireAdmin()`
- `createStrictServiceClient()`: strict service-role client for public or cryptographically gated server paths

Do not add new public routes that quietly rely on `createAdminClient()` or `SUPABASE_SERVICE_ROLE_KEY || anon` fallback patterns.

### 3. Database source of truth must stay aligned

There are two schema definitions that must match whenever you change tables, grants, policies, triggers, or functions:

1. `supabase/migrations/001_initial_schema.sql`
2. `src/app/api/admin/setup/route.ts` inside `SCHEMA_SQL`

The live project, `001_initial_schema.sql`, and `SCHEMA_SQL` should always converge back to the same final DDL.

### 4. Public routes are security-sensitive

Current public or semi-public surfaces include:

- `/setup`
- `/login`
- `/preview/**`
- `/voice/live/**`
- `/voice/asr/**`
- `/app/**`
- `/api/app/**`
- `/api/auth/login`
- `/api/webhook/**`
- `/api/worker/**`
- `/api/admin/setup`
- `/api/voice/live-config`
- `/api/voice/asr-config`
- `/api/voice/temp-link`

Any change here needs an explicit review of auth, secret exposure, replay resistance, and service-role usage.

### 5. Self-evolution is a first-class feature

- Treat self-evolution behavior as core product behavior, not a side experiment.
- If you change the GitHub/Vercel workflow, also update `skills/self-evolution-guide/SKILL.md`.
- Self-evolution changes should stay review-first and explicit about approval boundaries.

### 6. Sub-App baseline

For bearer-link sub-apps:

- Public page does not mean public database tables.
- Verify the signed token on every `/api/app/*` request.
- Keep business tables private to `service_role`/admin by default.
- Use `createStrictServiceClient()` for real data access.
- Prefer private Broadcast + Presence channels over public `postgres_changes`.

Useful references:

- `src/app/api/app/README.md`
- `src/lib/agent/README.md`

### 7. HTML preview and voice links

- `html_previews` and `/preview/[id]` should always treat stored HTML as untrusted.
- `voice_temp_links` gate pages that can expose upstream voice config to the browser.
- Preview and voice flows need careful review whenever sandboxing, token lookup, or config payload shape changes.

### 8. SQL and function grants

- Avoid blanket routine grants.
- New SQL functions should have explicit `GRANT EXECUTE` decisions.
- Tool-driven SQL access should default to the narrowest practical surface.

## Documentation Sync Rules

- Keep `README.md` and `README.zh-CN.md` structurally aligned.
- Keep `setup.md` and `setup.zh-CN.md` aligned with the real setup flow.
- If you change setup flow, supported channels, environment requirements, or major capabilities, update both READMEs and both setup guides.
- If you change self-evolution workflow behavior, update `skills/self-evolution-guide/SKILL.md`.

## Safe Change Checklist

- Run `pnpm lint` and `pnpm test:unit` for non-trivial code changes when feasible.
- Update both schema locations when changing DDL.
- Prefer `requireAdmin()` over “logged-in user” checks on admin APIs.
- Fail closed when required config or secrets are missing.
- Keep public routes minimal and independently verifiable.
- Do not broaden RLS or grants just to make a public page work.
