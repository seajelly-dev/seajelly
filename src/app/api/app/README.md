# Sub-App Development Guide

If you are about to build a new Sub-App, read this file first.

This directory is the backend entry for bearer-link Sub-Apps such as the chatroom. The most important rule is:

> A public Sub-App page does not mean the database should be public.

## Core Model

Sub-App request flow:

1. Agent tool creates an instance.
2. The tool generates a signed bearer link and sends it directly to the IM channel.
3. User opens `/app/{slug}/{id}?t=...` with no login required.
4. The page calls `/api/app/{slug}` with that token.
5. The server verifies the token and reads/writes with `service_role`.
6. If realtime is needed, the page calls `/api/app/{slug}/session` to exchange the signed token for a short-lived Realtime JWT.

Recommended file layout:

```text
Frontend page:  src/app/app/{slug}/[id]/page.tsx
Backend API:    src/app/api/app/{slug}/route.ts
Realtime API:   src/app/api/app/{slug}/session/route.ts
Token utils:    src/lib/{slug}-token.ts or src/lib/room-token.ts
Realtime JWT:   src/lib/{slug}-realtime.ts or src/lib/room-realtime.ts
Sub-App config: src/lib/sub-app-settings.ts + public.sub_app_settings
```

## Security Baseline

Recommended default:

- `/app/*` pages are public.
- `/api/app/*` routes are public.
- Business tables are private by default.
- The browser does not query business tables directly with the anon key.
- The server verifies the signed token on every request.
- The server performs real DB access with `createStrictServiceClient()`.

Do not do this:

- Do not grant `anon` direct `SELECT` or `INSERT` on business tables just because the page is public.
- Do not expose Sub-App tables through public `postgres_changes`.
- Do not silently fall back to weaker behavior when config is missing.

## Database Pattern

Recommended table access model:

```sql
ALTER TABLE public.your_slug_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "your_slug_instances_admin_all"
ON public.your_slug_instances
FOR ALL USING (public.is_admin());

CREATE POLICY "your_slug_instances_service_all"
ON public.your_slug_instances
FOR ALL USING (current_setting('role') = 'service_role');

GRANT ALL ON public.your_slug_instances TO service_role;
REVOKE ALL ON TABLE public.your_slug_instances FROM PUBLIC, anon, authenticated;
```

Guidelines:

- Keep business tables private.
- Use server APIs as the access boundary.
- Avoid blanket routine grants such as `GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon`.

## Required Migration Workflow

This repo keeps exactly one canonical schema file:

- `supabase/migrations/001_initial_schema.sql`

Required order:

1. Apply DDL to the live Supabase project first via Supabase MCP.
2. Do not create `002_*.sql`, `003_*.sql`, or any local incremental migration file.
3. Sync the final SQL back into `supabase/migrations/001_initial_schema.sql`.
4. Copy the exact same SQL block into `src/app/api/admin/setup/route.ts`.

These three must always match:

- live production DDL
- `001_initial_schema.sql`
- `src/app/api/admin/setup/route.ts`

## Sub-App Secrets and Config

If a secret belongs to a Sub-App feature, prefer storing it in `public.sub_app_settings` and managing it through the dashboard.

Chatroom examples:

- `ROOM_TOKEN_SECRET`
- `ROOM_REALTIME_JWT_PRIVATE_KEY`
- `ROOM_REALTIME_JWT_KID`

Rules:

- Encrypt the values before storing them.
- Load them through `src/lib/sub-app-settings.ts`.
- Fail closed with `503` when required config is missing.
- Do not fall back from strict server secrets to `anon` behavior.

## Backend API Rules

Typical routes:

- `GET /api/app/{slug}`: initial snapshot
- `POST /api/app/{slug}`: user actions
- `PATCH /api/app/{slug}`: owner actions
- `POST /api/app/{slug}/session`: short-lived Realtime JWT for private channels

Minimum API shape:

```ts
export const runtime = "nodejs";
export const maxDuration = 60;

const token = await verifyYourSubAppToken(tokenStr);
if (!token) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

const db = createStrictServiceClient();
```

Rules:

- Verify the signed token on every request.
- Use `createStrictServiceClient()` for security-sensitive reads and writes.
- Return `503` if Sub-App config is incomplete.
- If you use `after()`, keep the route on Node.js runtime.

## Frontend Realtime Pattern

For bearer-link Sub-Apps, prefer private Broadcast + Presence:

```ts
const session = await fetch("/api/app/your-slug/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ instance_id, token }),
}).then((res) => res.json());

await supabase.realtime.setAuth(session.realtimeJwt);

const channel = supabase
  .channel(session.topic, { config: { private: true } })
  .on("broadcast", { event: "INSERT" }, (rawPayload) => {
    const payload =
      rawPayload && typeof rawPayload === "object" && "payload" in rawPayload
        ? rawPayload.payload
        : rawPayload;

    // payload.record / payload.old_record / payload.operation
  })
  .on("presence", { event: "sync" }, () => {
    // handle online users
  });
```

Rules:

- Fetch the initial snapshot from your server API.
- Use `/session` to get a short-lived Realtime JWT.
- Refresh the JWT before it expires.
- Show a lightweight connection-state indicator in the page.
- Normalize Supabase broadcast payloads before type-checking them.

## Realtime RLS Pattern

For private Broadcast + Presence channels, both policies matter:

```sql
CREATE POLICY "your_slug_realtime_select" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension IN ('broadcast', 'presence')
    AND realtime.topic() = 'your-slug:' || (
      coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'instance_id'
    )
  );

CREATE POLICY "your_slug_realtime_insert" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    extension IN ('broadcast', 'presence')
    AND realtime.topic() = 'your-slug:' || (
      coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'instance_id'
    )
  );
```

If `broadcast` is missing from the `INSERT` policy, the page will often look like “messages only appear after refresh”.

## Agent Tool Rules

- Tools must send user-facing URLs directly with `sender.sendMarkdown()`.
- Tool strings must be internationalized.
- Do not hardcode names like `"Owner"`.
- Use explicit Markdown links such as `[Join]({url})`.
- Add Sub-App tool policy in `src/lib/agent/tooling/runtime.ts`, not ad-hoc in random places.

## Chatroom Lessons Learned

Real bugs we already hit:

- `anon` access on business tables made room-token boundaries meaningless.
- Using `postgres_changes` pushed the design back toward public table access.
- `realtime.messages` insert policy allowed `presence` but not `broadcast`, breaking realtime.
- Supabase broadcast payloads arrived wrapped in `payload.payload`, so the frontend ignored them.
- Supabase requires Realtime signing `kid` to be a UUID.
- The existing Supabase current ECC key is not automatically reusable by the app; OpenCrab must import and own its own private signing key.

## Reference Implementation

Use the chatroom as the reference:

- `src/app/api/app/room/route.ts`
- `src/app/api/app/room/session/route.ts`
- `src/app/app/room/[id]/page.tsx`
- `src/lib/room-token.ts`
- `src/lib/room-realtime.ts`
- `src/lib/sub-app-settings.ts`
- `supabase/migrations/001_initial_schema.sql`

## Pre-Launch Checklist

Before shipping a new bearer-link Sub-App, verify:

1. Business tables are not directly accessible to `anon`.
2. Every `/api/app/{slug}` request verifies the signed token.
3. Missing Sub-App config returns `503`.
4. Realtime JWTs are short-lived and refreshed before expiry.
5. Broadcast payload parsing matches the actual Supabase payload shape.
6. `001_initial_schema.sql` and `src/app/api/admin/setup/route.ts` match the production DDL.
