# OpenCrab Agent Notes

## Project Snapshot

- Stack: Next.js App Router, React 19, TypeScript, Supabase, Vercel.
- Purpose: multi-channel AI agent platform with admin dashboard, webhook ingestion, task scheduling, knowledge base, coding sandbox, voice/live ASR, and sub-app chat rooms.
- Main runtime surface:
  - `src/app/api/**`: server routes
  - `src/lib/**`: core business logic
  - `supabase/migrations/**`: database schema and RLS

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm test:unit
```

## Important Directories

- `src/app/(dashboard)`: authenticated dashboard pages
- `src/app/api/admin`: admin APIs
- `src/app/api/webhook`: platform webhook entrypoints
- `src/app/api/voice`: voice temp-link and config APIs
- `src/app/api/app/room`: sub-app chat room APIs
- `src/lib/agent`: agent loop, tools, command handlers
- `src/lib/platform`: sender adapters and webhook handling
- `src/lib/supabase`: auth/admin client helpers and middleware
- `src/lib/security`: URL validation and login gate
- `supabase/migrations/001_initial_schema.sql`: current DB schema

## Auth And Access Model

- Global auth gate lives in `src/lib/supabase/middleware.ts`.
- Dashboard layout only checks `supabase.auth.getUser()`, not admin role.
- Real admin authorization is implemented in `src/lib/supabase/server.ts` via `requireAdmin()`.
- Any `/api/admin/**` route that uses `createAdminClient()` but skips `requireAdmin()` should be treated as privilege-escalation sensitive.

## Database Source Of Truth

There are two schema sources that must stay aligned:

1. `supabase/migrations/001_initial_schema.sql`
2. `src/app/api/admin/setup/route.ts` inside `SCHEMA_SQL`

If you fix a policy, grant, trigger, or table definition in only one place, new installs and existing installs will diverge.

## Security-Critical Surfaces

### 1. Public And Semi-Public Routes

- `src/lib/supabase/middleware.ts` explicitly leaves these public:
  - `/api/webhook/**`
  - `/api/worker/**`
  - `/api/admin/setup`
  - `/api/voice/live-config`
  - `/api/voice/asr-config`
  - `/api/voice/temp-link`
  - `/api/app/**`
  - `/preview/**`

### 2. Service-Role Reads/Writes

- Many server routes build a Supabase client with:
  - `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`
- For public routes, this fallback is security-sensitive because it can silently widen access patterns.

### 3. Webhook Verification

- Telegram and Slack have signature/secret checks.
- Feishu and WhatsApp handlers need extra scrutiny before trusting payloads.

### 4. HTML Preview

- Coding preview data is stored in `html_previews`.
- Preview rendering is served from `/preview/[id]`.
- Treat any `srcDoc`, iframe sandbox, or stored HTML path as XSS-sensitive.

### 5. Voice Temp Links

- `voice_temp_links` are used to unlock live/ASR config endpoints.
- Those config routes return decrypted upstream API credentials to the browser.
- Any weakness in temp-link issuance or selection becomes a key-exfiltration issue.

### 6. Sub-App Chat Rooms

- `chat_rooms` and `chat_room_messages` are the sub-app collaboration surface.
- Room token checks exist in `src/lib/room-token.ts` and `src/app/api/app/room/route.ts`.
- RLS must not be broader than the room-token assumptions.

## Current Audit Findings To Keep In Mind

### Critical

- `voice_temp_links` are exposed to `anon` at the database layer, and `/api/voice/temp-link` is public. Combined with `/api/voice/live-config` and `/api/voice/asr-config`, this can expose decrypted voice provider API keys.
- `chat_rooms` and `chat_room_messages` are readable by `anon`, and `chat_room_messages` is insertable by `anon`. This bypasses the room-token control model and exposes conversation data directly through Supabase.

### High

- Feishu webhook handler does not verify request authenticity before processing event bodies.
- WhatsApp webhook POST handler accepts payloads without verifying Meta request signatures.
- `/api/admin/coding/e2b/preview` skips `requireAdmin()` and writes with `createAdminClient()`.
- `/preview/[id]` renders stored HTML with `sandbox="allow-scripts allow-same-origin"`, which is unsafe for untrusted preview content.

### High / Structural

- The schema grants `ALL ON ALL ROUTINES IN SCHEMA public` to `anon`, while several RPCs are `SECURITY DEFINER`. This makes future database changes easy to accidentally expose, and some current RPCs already surface internal data.

## Safe Change Checklist

- When changing RLS or grants, update both schema locations.
- Prefer `requireAdmin()` for admin APIs; do not rely on “logged-in user” checks alone.
- Do not add public routes that use `createAdminClient()` or service-role access unless the route has an independent cryptographic gate.
- For webhooks, verify signatures before parsing business payloads.
- For preview/HTML features, do not combine `allow-scripts` with `allow-same-origin` for untrusted content.
- For tokenized public access, ensure database RLS matches the token boundary instead of relying only on application routes.
- Before adding new SQL functions, decide explicitly who may `EXECUTE` them; do not rely on blanket routine grants.

## Good Existing Controls

- `src/lib/security/url-validator.ts` implements solid SSRF protections and is already used in MCP/skills paths.
- Secret material is encrypted with AES-256-GCM in `src/lib/crypto/encrypt.ts`.
- Slack and Telegram webhook handlers show the intended verification pattern.

## Suggested Next Fix Order

1. Lock down `voice_temp_links`, `chat_rooms`, and `chat_room_messages` RLS/grants.
2. Add strict auth to `/api/voice/temp-link` and admin-only auth to `/api/admin/coding/e2b/preview`.
3. Fix preview sandboxing and treat stored preview HTML as untrusted.
4. Add Feishu and WhatsApp signature verification.
5. Replace blanket routine grants with explicit `GRANT EXECUTE` only where needed.
