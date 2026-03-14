"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  RefreshCw,
  AppWindow,
  Bot,
  Wrench,
  BookOpen,
  Globe,
  Settings2,
  ShieldAlert,
  Copy,
  KeyRound,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type { SubApp, Agent } from "@/types/database";

interface ManagedSubApp extends SubApp {
  config_complete?: boolean;
  config_configured_keys?: string[];
  config_missing_keys?: string[];
  config_invalid_keys?: string[];
}

interface RoomSettingsStatus {
  complete: boolean;
  configuredKeys: string[];
  missingKeys: string[];
  invalidKeys: string[];
  publicKeyPem: string | null;
  roomRealtimeJwtKid: string | null;
  supabaseImportJwk: string | null;
  kidIsUuid: boolean;
}

/* ------------------------------------------------------------------ */
/*  Dev Guide content — inline JSX, no markdown lib needed            */
/* ------------------------------------------------------------------ */

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 text-[13px] leading-relaxed font-mono">
      <code>{children}</code>
    </pre>
  );
}

const article = "max-w-none space-y-5 text-sm leading-relaxed text-foreground [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:pb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-8 [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-6 [&_h4]:mb-1 [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:text-muted-foreground [&_li]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:font-mono [&_code]:text-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-foreground [&_strong]:font-semibold [&_table]:w-full [&_table]:text-sm [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted/50 [&_th]:font-medium [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:text-muted-foreground";

function DevGuide({ lang }: { lang: "en" | "zh" }) {
  if (lang === "zh") return <DevGuideZh />;
  return <DevGuideEn />;
}

function DevGuideEn() {
  return (
    <article className={article}>
      <h2>What is a Sub-App?</h2>
      <p>
        A <strong>Sub-App</strong> is SEAJelly&apos;s Agent-native GUI interaction model. The page can be public and login-free, but the underlying data should still stay private by default.
      </p>
      <p>The core flow:</p>
      <ol>
        <li>Agent receives a command or semantic trigger</li>
        <li>Agent calls a tool to create an instance (e.g., a chatroom, poll, whiteboard)</li>
        <li>A unique URL with a <strong>signed token</strong> is generated and <strong>directly sent</strong> to IM channels</li>
        <li>Users open the link — identity is auto-recognized from the token, no login required</li>
        <li>The public page calls server APIs with that token</li>
        <li>If realtime is needed, the server exchanges the signed token for a <strong>short-lived Realtime JWT</strong></li>
      </ol>
      <p>
        Full reference: <code>src/app/api/app/README.md</code>
      </p>

      <h2>Directory &amp; Routing Conventions</h2>
      <CodeBlock>{`Frontend page:  src/app/app/{slug}/[id]/page.tsx   →  /app/{slug}/{instance-id}
Backend API:    src/app/api/app/{slug}/route.ts     →  /api/app/{slug}
Realtime API:   src/app/api/app/{slug}/session/route.ts → /api/app/{slug}/session
Database:       {slug}_* tables                     →  e.g., chat_rooms, chat_room_messages
Agent tools:    src/lib/agent/tools.ts              →  createSubAppTools()
Shared tooling: src/lib/agent/tooling/*             →  policy, toolkit, runtime resolution
Token utils:    src/lib/room-token.ts               →  signRoomToken(), verifyRoomToken(), buildRoomUrl()
Realtime JWT:   src/lib/room-realtime.ts            →  create{Slug}RealtimeSession()
Sub-App config: public.sub_app_settings + src/lib/sub-app-settings.ts`}</CodeBlock>

      <h2>Security-First Baseline</h2>
      <p>
        A public Sub-App page does <strong>not</strong> mean the database should be public. This is the main rule to keep in mind.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Layer</th><th>Recommended model</th></tr></thead>
          <tbody>
            <tr><td>Page</td><td>Public, login-free, bearer-link based</td></tr>
            <tr><td>Business tables</td><td>Private by default, no direct <code>anon</code> access</td></tr>
            <tr><td>Server API</td><td>Verifies signed token, then uses <code>createStrictServiceClient()</code></td></tr>
            <tr><td>Realtime</td><td>Private Broadcast + Presence, not public <code>postgres_changes</code></td></tr>
            <tr><td>Sub-App secrets</td><td>Stored in <code>sub_app_settings</code>, not scattered across env vars</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        If a public page needs data, return it from <code>/api/app/&#123;slug&#125;</code> after verifying the signed token. Do not grant <code>anon</code> direct <code>SELECT</code> or <code>INSERT</code> on business tables just because the page itself is public.
      </p>

      <h2>Schema Workflow</h2>
      <ol>
        <li>Apply DDL to the live Supabase project <strong>first</strong> via Supabase MCP</li>
        <li>Do not create local incremental files like <code>002_*.sql</code></li>
        <li>Sync the final SQL back into <code>supabase/migrations/001_initial_schema.sql</code></li>
        <li>Copy the exact same SQL block into <code>src/app/api/admin/setup/route.ts</code></li>
      </ol>
      <p>
        These three must stay aligned: live project, <code>001_initial_schema.sql</code>, and <code>setup/route.ts</code>.
      </p>

      <h2>Recommended DB Pattern</h2>
      <CodeBlock>{`ALTER TABLE public.your_slug_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "your_slug_instances_admin_all"
ON public.your_slug_instances
FOR ALL USING (public.is_admin());

CREATE POLICY "your_slug_instances_service_all"
ON public.your_slug_instances
FOR ALL USING (current_setting('role') = 'service_role');

GRANT ALL ON public.your_slug_instances TO service_role;
REVOKE ALL ON TABLE public.your_slug_instances FROM PUBLIC, anon, authenticated;`}</CodeBlock>
      <p>
        Avoid blanket routine grants such as <code>GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon</code>. Only grant what is explicitly required.
      </p>

      <h2>Realtime Pattern</h2>
      <p>
        For bearer-link Sub-Apps, prefer private Realtime channels. The browser should not subscribe to business tables directly.
      </p>
      <CodeBlock>{`// 1. Browser fetches initial snapshot
GET /api/app/{slug}

// 2. Browser exchanges signed token for short-lived realtime session
POST /api/app/{slug}/session
→ { realtimeJwt, topic, expiresAt }

// 3. Browser connects to private channel
await supabase.realtime.setAuth(session.realtimeJwt)
supabase.channel(session.topic, { config: { private: true } })`}</CodeBlock>
      <p>
        Recommended database side:
      </p>
      <ul>
        <li>Use <code>realtime.broadcast_changes(...)</code> from triggers</li>
        <li>Authorize channel access through <code>realtime.messages</code> RLS</li>
        <li>Allow both <code>broadcast</code> and <code>presence</code> on the matching topic</li>
      </ul>

      <h2>Server API Rules</h2>
      <ul>
        <li><code>GET</code> for initial snapshot</li>
        <li><code>POST</code> for user actions</li>
        <li><code>PATCH</code> for owner actions</li>
        <li><code>POST /session</code> for realtime-enabled Sub-Apps</li>
      </ul>
      <CodeBlock>{`export const runtime = "nodejs";
export const maxDuration = 60;

const token = await verifyYourSubAppToken(tokenStr);
if (!token) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

const db = createStrictServiceClient();`}</CodeBlock>
      <p>
        Missing Sub-App config should fail closed with <code>503</code>. Do not silently fall back to weaker behavior.
      </p>

      <h2>Frontend Rules</h2>
      <ul>
        <li>Read identity from <code>?t=</code>, not from login state</li>
        <li>Fetch the initial snapshot from your server API</li>
        <li>Use private Broadcast + Presence for incremental updates</li>
        <li>Refresh the short-lived realtime JWT before it expires</li>
        <li>Show a lightweight connection-state indicator</li>
      </ul>
      <CodeBlock>{`const session = await fetch("/api/app/your-slug/session", {
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
  });`}</CodeBlock>

      <h2>Agent Tool Rules</h2>
      <ul>
        <li>Tools must send URLs directly with <code>sender.sendMarkdown()</code></li>
        <li>All tool-facing strings must be internationalized</li>
        <li>Do not hardcode names like <code>&quot;Owner&quot;</code></li>
        <li>Use explicit Markdown links: <code>[Join](&#123;url&#125;)</code></li>
      </ul>

      <h2>Chatroom Lessons Learned</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Public page does not mean public database</h4>
          <p className="text-sm font-medium">Do not give business tables direct <code>anon</code> read/write access just because the page is public.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Do not use <code>postgres_changes</code> for bearer-link Sub-Apps</h4>
          <p className="text-sm font-medium">Private Broadcast + Presence keeps business tables private and scales better for this model.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Realtime insert policy must allow both <code>broadcast</code> and <code>presence</code></h4>
          <p className="text-sm font-medium">If <code>broadcast</code> is missing from <code>realtime.messages</code> insert policy, messages will only show up after refresh.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Supabase broadcast payloads are wrapped</h4>
          <p className="text-sm font-medium">The useful fields may be under <code>payload.payload</code>. Normalize first, then type-check.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Realtime signing KID must be a UUID</h4>
          <p className="text-sm font-medium">Generate it with <code>crypto.randomUUID()</code>, not random hex.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">OpenCrab must import its own private signing key into Supabase</h4>
          <p className="text-sm font-medium">The existing current ECC key shown in Supabase is not automatically reusable by the app.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Missing Sub-App config must fail closed</h4>
          <p className="text-sm font-medium">Return <code>503</code> and block startup. Do not silently downgrade to <code>anon</code> behavior.</p>
        </div>
      </div>

      <h2>Reference Implementation: Chatroom</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Layer</th><th>File</th></tr></thead>
          <tbody>
            <tr><td>Database</td><td><code>001_initial_schema.sql</code> — <code>chat_rooms</code>, <code>chat_room_messages</code></td></tr>
            <tr><td>Sub-App config</td><td><code>public.sub_app_settings</code>, <code>src/lib/sub-app-settings.ts</code></td></tr>
            <tr><td>Token</td><td><code>src/lib/room-token.ts</code></td></tr>
            <tr><td>Realtime JWT</td><td><code>src/lib/room-realtime.ts</code></td></tr>
            <tr><td>Agent tools</td><td><code>src/lib/agent/tools.ts</code> — <code>create_chat_room</code>, <code>close_chat_room</code>, <code>reopen_chat_room</code></td></tr>
            <tr><td>Backend API</td><td><code>src/app/api/app/room/route.ts</code></td></tr>
            <tr><td>Realtime API</td><td><code>src/app/api/app/room/session/route.ts</code></td></tr>
            <tr><td>Frontend</td><td><code>src/app/app/room/[id]/page.tsx</code></td></tr>
          </tbody>
        </table>
      </div>

      <h2>Pre-Launch Checklist</h2>
      <ol>
        <li>Business tables are not directly accessible to <code>anon</code></li>
        <li>Every <code>/api/app/&#123;slug&#125;</code> request verifies the signed token</li>
        <li>Missing Sub-App config returns <code>503</code></li>
        <li>If realtime is enabled, the page refreshes the short-lived JWT before expiry</li>
        <li><code>001_initial_schema.sql</code> and <code>setup/route.ts</code> match the production DDL</li>
      </ol>
    </article>
  );
}

function DevGuideZh() {
  return (
    <article className={article}>
      <h2>什么是 Sub-App？</h2>
      <p>
        <strong>Sub-App</strong> 是 SEAJelly 的 <strong>Agent 原生 GUI 交互模式</strong>。页面可以公开、无登录，但底层业务数据默认仍然应该保持私有。
      </p>
      <p>核心流程：</p>
      <ol>
        <li>Agent 收到命令或语义触发</li>
        <li>Agent 调用工具创建实例（如聊天室、投票、白板）</li>
        <li>生成带<strong>签名 Token</strong> 的唯一 URL，<strong>由工具直接发送</strong>到 IM 频道</li>
        <li>用户打开链接——身份从 Token 自动识别，无需登录</li>
        <li>公开页面带着这个 Token 调服务端 API</li>
        <li>如果需要 Realtime，再由服务端换取一个<strong>短时有效</strong>的 Realtime JWT</li>
      </ol>
      <p>
        完整版参考：<code>src/app/api/app/README.md</code>
      </p>

      <h2>目录与路由约定</h2>
      <CodeBlock>{`前端页面:    src/app/app/{slug}/[id]/page.tsx   →  /app/{slug}/{实例ID}
后端 API:    src/app/api/app/{slug}/route.ts     →  /api/app/{slug}
Realtime API: src/app/api/app/{slug}/session/route.ts → /api/app/{slug}/session
数据表:      {slug}_* 表                         →  如 chat_rooms, chat_room_messages
Agent 工具:  src/lib/agent/tools.ts              →  createSubAppTools()
Shared tooling: src/lib/agent/tooling/*          →  策略、toolkit、运行时解析
Token 工具:  src/lib/room-token.ts               →  signRoomToken(), verifyRoomToken(), buildRoomUrl()
Realtime JWT: src/lib/room-realtime.ts           →  create{Slug}RealtimeSession()
子应用配置:   public.sub_app_settings + src/lib/sub-app-settings.ts`}</CodeBlock>

      <h2>安全基线</h2>
      <p>
        公开 Sub-App 页面，不等于公开数据库。这是后续所有设计的前提。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>层</th><th>推荐模型</th></tr></thead>
          <tbody>
            <tr><td>页面</td><td>公开、免登录、bearer link</td></tr>
            <tr><td>业务表</td><td>默认私有，不直接给 <code>anon</code> 权限</td></tr>
            <tr><td>服务端 API</td><td>先校验签名 Token，再用 <code>createStrictServiceClient()</code></td></tr>
            <tr><td>Realtime</td><td>私有 Broadcast + Presence，不走公开 <code>postgres_changes</code></td></tr>
            <tr><td>子应用密钥</td><td>放在 <code>sub_app_settings</code>，不要四处分散在 env</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        如果公开页面需要数据，应由 <code>/api/app/&#123;slug&#125;</code> 在服务端校验 Token 后返回。不要因为页面公开，就给业务表直接开放 <code>anon</code> 读写。
      </p>

      <h2>Schema 流程</h2>
      <ol>
        <li>先通过 Supabase MCP 把 DDL 作用到线上项目</li>
        <li>不要创建本地增量迁移文件，例如 <code>002_*.sql</code></li>
        <li>把最终 SQL 回写到 <code>supabase/migrations/001_initial_schema.sql</code></li>
        <li>再把完全相同的 SQL 同步到 <code>src/app/api/admin/setup/route.ts</code></li>
      </ol>
      <p>
        线上项目、<code>001_initial_schema.sql</code>、<code>setup/route.ts</code> 这三处必须保持一致。
      </p>

      <h2>推荐的数据层模式</h2>
      <CodeBlock>{`ALTER TABLE public.your_slug_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "your_slug_instances_admin_all"
ON public.your_slug_instances
FOR ALL USING (public.is_admin());

CREATE POLICY "your_slug_instances_service_all"
ON public.your_slug_instances
FOR ALL USING (current_setting('role') = 'service_role');

GRANT ALL ON public.your_slug_instances TO service_role;
REVOKE ALL ON TABLE public.your_slug_instances FROM PUBLIC, anon, authenticated;`}</CodeBlock>
      <p>
        不要再使用 <code>GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon</code> 这种整库放开的方式。函数权限应按白名单逐个授权。
      </p>

      <h2>Realtime 模式</h2>
      <p>
        对 bearer-link 类型的 Sub-App，推荐私有 Realtime 频道。浏览器不应直接订阅业务表。
      </p>
      <CodeBlock>{`// 1. 浏览器先拉初始快照
GET /api/app/{slug}

// 2. 浏览器用签名 Token 换一个短时 realtime session
POST /api/app/{slug}/session
→ { realtimeJwt, topic, expiresAt }

// 3. 浏览器连接私有频道
await supabase.realtime.setAuth(session.realtimeJwt)
supabase.channel(session.topic, { config: { private: true } })`}</CodeBlock>
      <p>数据库侧推荐：</p>
      <ul>
        <li>通过 trigger 调用 <code>realtime.broadcast_changes(...)</code></li>
        <li>用 <code>realtime.messages</code> 的 RLS 控制频道权限</li>
        <li>对同一个频道同时放行 <code>broadcast</code> 和 <code>presence</code></li>
      </ul>

      <h2>服务端 API 规则</h2>
      <ul>
        <li><code>GET</code>：初始快照</li>
        <li><code>POST</code>：用户操作</li>
        <li><code>PATCH</code>：实控人操作</li>
        <li><code>POST /session</code>：Realtime 子应用专用</li>
      </ul>
      <CodeBlock>{`export const runtime = "nodejs";
export const maxDuration = 60;

const token = await verifyYourSubAppToken(tokenStr);
if (!token) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

const db = createStrictServiceClient();`}</CodeBlock>
      <p>
        如果子应用配置缺失，应 fail-close 返回 <code>503</code>，不要做静默降级。
      </p>

      <h2>前端规则</h2>
      <ul>
        <li>从 <code>?t=</code> 读取身份，而不是依赖登录态</li>
        <li>初始快照走服务端 API</li>
        <li>增量更新走私有 Broadcast + Presence</li>
        <li>在 realtime JWT 到期前自动刷新</li>
        <li>页面里最好有一个轻量的连接状态提示</li>
      </ul>
      <CodeBlock>{`const session = await fetch("/api/app/your-slug/session", {
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
  });`}</CodeBlock>

      <h2>Agent 工具规则</h2>
      <ul>
        <li>工具必须直接通过 <code>sender.sendMarkdown()</code> 发送 URL</li>
        <li>所有面向用户的文案都必须国际化</li>
        <li>不要硬编码 <code>&quot;Owner&quot;</code> 之类的身份名</li>
        <li>IM 链接使用显式 Markdown 语法：<code>[加入](&#123;url&#125;)</code></li>
      </ul>

      <h2>聊天室踩坑总结</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">公开页面不等于公开数据库</h4>
          <p className="text-sm font-medium">不要因为页面公开，就给业务表直接开放 <code>anon</code> 读写。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">bearer-link 类型子应用不要继续走 <code>postgres_changes</code></h4>
          <p className="text-sm font-medium">私有 Broadcast + Presence 更适合这类模式，也更容易收住安全边界。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Realtime 写策略必须同时放行 <code>broadcast</code> 和 <code>presence</code></h4>
          <p className="text-sm font-medium">如果漏掉 <code>broadcast</code>，前端通常就会表现成“刷新后才看到消息”。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Supabase 的广播 payload 有一层包裹</h4>
          <p className="text-sm font-medium">真正有用的字段可能在 <code>payload.payload</code>，要先归一化再做类型判断。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Realtime 签名 KID 必须是 UUID</h4>
          <p className="text-sm font-medium">请统一用 <code>crypto.randomUUID()</code>，不要自己生成随机 hex。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">OpenCrab 必须导入一把自己持有私钥的签名 key 到 Supabase</h4>
          <p className="text-sm font-medium">Supabase 里当前显示的 ECC key 不能默认直接拿来给应用签 JWT。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">子应用配置缺失时必须 fail-close</h4>
          <p className="text-sm font-medium">直接返回 <code>503</code>，阻止页面完整拉起，不要静默降级成更弱的安全模型。</p>
        </div>
      </div>

      <h2>参考实现：聊天室（Chatroom）</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>层级</th><th>文件</th></tr></thead>
          <tbody>
            <tr><td>数据库</td><td><code>001_initial_schema.sql</code> — <code>chat_rooms</code>、<code>chat_room_messages</code></td></tr>
            <tr><td>子应用配置</td><td><code>public.sub_app_settings</code>、<code>src/lib/sub-app-settings.ts</code></td></tr>
            <tr><td>Token</td><td><code>src/lib/room-token.ts</code></td></tr>
            <tr><td>Realtime JWT</td><td><code>src/lib/room-realtime.ts</code></td></tr>
            <tr><td>Agent 工具</td><td><code>src/lib/agent/tools.ts</code> — <code>create_chat_room</code>、<code>close_chat_room</code>、<code>reopen_chat_room</code></td></tr>
            <tr><td>后端 API</td><td><code>src/app/api/app/room/route.ts</code></td></tr>
            <tr><td>Realtime API</td><td><code>src/app/api/app/room/session/route.ts</code></td></tr>
            <tr><td>前端页面</td><td><code>src/app/app/room/[id]/page.tsx</code></td></tr>
          </tbody>
        </table>
      </div>

      <h2>上线前检查</h2>
      <ol>
        <li>业务表没有直接开放给 <code>anon</code> 读写</li>
        <li>每个 <code>/api/app/&#123;slug&#125;</code> 请求都会校验签名 Token</li>
        <li>子应用缺配置时会返回 <code>503</code></li>
        <li>如果启用了 Realtime，页面会在 JWT 过期前自动刷新</li>
        <li><code>001_initial_schema.sql</code> 和 <code>setup/route.ts</code> 已与线上 DDL 同步</li>
      </ol>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */

export default function SubAppsPage() {
  const t = useT();
  const [subApps, setSubApps] = useState<ManagedSubApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<SubApp | null>(null);
  const [boundAgentIds, setBoundAgentIds] = useState<string[]>([]);
  const [bindSaving, setBindSaving] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<ManagedSubApp | null>(null);
  const [roomSettingsStatus, setRoomSettingsStatus] = useState<RoomSettingsStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [roomSettingsForm, setRoomSettingsForm] = useState({
    ROOM_TOKEN_SECRET: "",
    ROOM_REALTIME_JWT_PRIVATE_KEY: "",
    ROOM_REALTIME_JWT_KID: "",
  });
  const [activeTab, setActiveTab] = useState<"manage" | "guide">("manage");
  const [guideLang, setGuideLang] = useState<"en" | "zh">("en");

  const formatRoomMissingKeys = useCallback(
    (missingKeys: string[] | undefined) => {
      const keys = missingKeys?.filter(Boolean).join(", ");
      return keys
        ? t("subApps.roomSecurity.missing", { keys })
        : t("subApps.roomSecurity.missingFallback");
    },
    [t],
  );

  const formatRoomInvalidKeys = useCallback(
    (invalidKeys: string[] | undefined) => {
      const keys = invalidKeys?.filter(Boolean).join(", ");
      return t("subApps.roomSecurity.invalid", {
        keys: keys || "ROOM_REALTIME_JWT_KID",
      });
    },
    [t],
  );

  const fetchSubApps = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sub-apps");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubApps(data.sub_apps ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subApps.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchAgents = useCallback(async () => {
    if (agents.length > 0) return;
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      if (res.ok) setAgents(data.agents ?? []);
    } catch {
      /* non-critical */
    }
  }, [agents.length]);

  useEffect(() => {
    fetchSubApps();
  }, [fetchSubApps]);

  const toggleEnabled = async (app: SubApp) => {
    try {
      const res = await fetch("/api/admin/sub-apps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id, enabled: !app.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubApps((prev) =>
        prev.map((s) =>
          s.id === app.id ? { ...s, enabled: !s.enabled } : s
        )
      );
      toast.success(t("subApps.toggleSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subApps.toggleFailed"));
    }
  };

  const openBind = async (app: SubApp) => {
    setBindTarget(app);
    setBindDialogOpen(true);
    setBoundAgentIds([]);
    fetchAgents();
    try {
      const res = await fetch(`/api/admin/sub-apps?sub_app_id=${app.id}`);
      const data = await res.json();
      if (res.ok) setBoundAgentIds(data.agent_ids ?? []);
    } catch {
      /* non-critical */
    }
  };

  const toggleAgent = (agentId: string) => {
    setBoundAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleBindSave = async () => {
    if (!bindTarget) return;
    setBindSaving(true);
    try {
      const res = await fetch("/api/admin/sub-apps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub_app_id: bindTarget.id,
          agent_ids: boundAgentIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("subApps.bindSuccess"));
      setBindDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("subApps.bindFailed"));
    } finally {
      setBindSaving(false);
    }
  };

  const openSettings = async (app: ManagedSubApp) => {
    setSettingsTarget(app);
    setSettingsDialogOpen(true);
    setRoomSettingsStatus(null);
    setRoomSettingsForm({
      ROOM_TOKEN_SECRET: "",
      ROOM_REALTIME_JWT_PRIVATE_KEY: "",
      ROOM_REALTIME_JWT_KID: "",
    });
    if (app.slug === "room") {
      setSettingsLoading(true);
      await fetch("/api/admin/sub-apps/settings?sub_app_slug=room")
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data.error);
          setRoomSettingsStatus(data);
          setRoomSettingsForm({
            ROOM_TOKEN_SECRET: "",
            ROOM_REALTIME_JWT_PRIVATE_KEY: "",
            ROOM_REALTIME_JWT_KID: data.roomRealtimeJwtKid || "",
          });
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : t("subApps.roomSecurity.loadFailed"),
          );
        })
        .finally(() => {
          setSettingsLoading(false);
        });
    }
  };

  const copyValue = async (value: string | null | undefined, successMessage: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  };

  const fillGeneratedKid = () => {
    setRoomSettingsForm((current) => ({
      ...current,
      ROOM_REALTIME_JWT_KID: globalThis.crypto.randomUUID(),
    }));
    toast.success(t("subApps.roomSecurity.generateKidSuccess"));
  };

  const saveRoomSettings = async () => {
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/admin/sub-apps/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub_app_slug: "room",
          settings: roomSettingsForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRoomSettingsStatus(data);
      setRoomSettingsForm({
        ROOM_TOKEN_SECRET: "",
        ROOM_REALTIME_JWT_PRIVATE_KEY: "",
        ROOM_REALTIME_JWT_KID: data.roomRealtimeJwtKid || "",
      });
      await fetchSubApps();
      toast.success(t("subApps.roomSecurity.saveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("subApps.roomSecurity.saveFailed"),
      );
    } finally {
      setSettingsSaving(false);
    }
  };

  const generateRoomSettings = async () => {
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/admin/sub-apps/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub_app_slug: "room",
          action: "generate_room_security_bundle",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRoomSettingsStatus(data);
      setRoomSettingsForm({
        ROOM_TOKEN_SECRET: "",
        ROOM_REALTIME_JWT_PRIVATE_KEY: "",
        ROOM_REALTIME_JWT_KID: data.roomRealtimeJwtKid || "",
      });
      await fetchSubApps();
      toast.success(t("subApps.roomSecurity.generateSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("subApps.roomSecurity.generateFailed"),
      );
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("subApps.title")}</h1>
          <p className="text-muted-foreground">{t("subApps.subtitle")}</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setActiveTab("manage")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "manage"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <AppWindow className="inline-block mr-1.5 size-4" />
          {t("subApps.title")}
        </button>
        <button
          onClick={() => setActiveTab("guide")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "guide"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <BookOpen className="inline-block mr-1.5 size-4" />
          {t("subApps.guide")}
        </button>
      </div>

      {activeTab === "manage" && (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                fetchSubApps();
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("common.refresh")}
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : subApps.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <AppWindow className="size-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">{t("subApps.noSubApps")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {subApps.map((app) => (
                <Card key={app.id} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <AppWindow className="size-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{app.name}</CardTitle>
                          <CardDescription className="text-xs font-mono">
                            /{app.slug}
                          </CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={app.enabled}
                        onCheckedChange={() => toggleEnabled(app)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {app.description && (
                      <p className="text-sm text-muted-foreground">{app.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Wrench className="size-3.5 text-muted-foreground shrink-0" />
                      {app.tool_names.map((name) => (
                        <Badge key={name} variant="secondary" className="text-xs font-mono">
                          {name}
                        </Badge>
                      ))}
                    </div>
                    {app.slug === "room" && (
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {t("subApps.roomSecurity.cardTitle")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {app.config_complete
                                ? t("subApps.roomSecurity.configured")
                                : (app.config_invalid_keys ?? []).length > 0
                                  ? formatRoomInvalidKeys(app.config_invalid_keys)
                                  : formatRoomMissingKeys(app.config_missing_keys)}
                            </p>
                          </div>
                          <Badge variant={app.config_complete ? "secondary" : "destructive"}>
                            {app.config_complete
                              ? t("subApps.roomSecurity.ready")
                              : t("subApps.roomSecurity.required")}
                          </Badge>
                        </div>
                      </div>
                    )}
                    {app.slug === "room" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => openSettings(app)}
                      >
                        <Settings2 className="mr-2 size-4" />
                        {t("subApps.roomSecurity.button")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => openBind(app)}
                    >
                      <Bot className="mr-2 size-4" />
                      {t("subApps.bindAgents")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "guide" && (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGuideLang(guideLang === "en" ? "zh" : "en")}
            >
              <Globe className="mr-2 size-4" />
              {guideLang === "en" ? "中文" : "English"}
            </Button>
          </div>
          <DevGuide lang={guideLang} />
        </>
      )}

      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-4 pr-12 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-4" />
              {t("subApps.roomSecurity.dialogTitle", {
                name: settingsTarget?.name || "Sub-App",
              })}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t("subApps.roomSecurity.dialogDesc")}
            </p>
          </DialogHeader>

          {settingsTarget?.slug === "room" && (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <KeyRound className="size-4" />
                      {t("subApps.roomSecurity.currentStatusTitle")}
                    </CardTitle>
                    <CardDescription>
                      {t("subApps.roomSecurity.currentStatusDesc")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {settingsLoading ? (
                      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm">
                            <p className="font-medium">
                              {roomSettingsStatus?.complete
                                ? t("subApps.roomSecurity.complete")
                                : t("subApps.roomSecurity.incomplete")}
                            </p>
                            <p className="text-muted-foreground">
                              {(roomSettingsStatus?.missingKeys ?? []).length > 0
                                ? formatRoomMissingKeys(roomSettingsStatus?.missingKeys)
                                : t("subApps.roomSecurity.allConfigured")}
                            </p>
                          </div>
                          <Badge variant={roomSettingsStatus?.complete ? "secondary" : "destructive"}>
                            {roomSettingsStatus?.complete
                              ? t("subApps.roomSecurity.ready")
                              : t("subApps.roomSecurity.required")}
                          </Badge>
                        </div>

                        <div className="rounded-md border bg-muted/40 p-4 text-sm">
                          <div className="flex flex-col gap-3">
                            <div>
                              <p className="font-medium text-foreground">
                                {t("subApps.roomSecurity.supabaseGuideTitle")}
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                {t("subApps.roomSecurity.supabaseGuideDesc")}
                              </p>
                            </div>
                            <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
                              <li>
                                <span className="font-medium text-foreground">
                                  {t("subApps.roomSecurity.step1Title")}
                                </span>
                                <p className="mt-1">{t("subApps.roomSecurity.step1Desc")}</p>
                              </li>
                              <li>
                                <span className="font-medium text-foreground">
                                  {t("subApps.roomSecurity.step2Title")}
                                </span>
                                <p className="mt-1">{t("subApps.roomSecurity.step2Desc")}</p>
                              </li>
                              <li>
                                <span className="font-medium text-foreground">
                                  {t("subApps.roomSecurity.step3Title")}
                                </span>
                                <p className="mt-1">{t("subApps.roomSecurity.step3Desc")}</p>
                              </li>
                              <li>
                                <span className="font-medium text-foreground">
                                  {t("subApps.roomSecurity.step4Title")}
                                </span>
                                <p className="mt-1">{t("subApps.roomSecurity.step4Desc")}</p>
                              </li>
                              <li>
                                <span className="font-medium text-foreground">
                                  {t("subApps.roomSecurity.step5Title")}
                                </span>
                                <p className="mt-1">{t("subApps.roomSecurity.step5Desc")}</p>
                              </li>
                            </ol>
                          </div>
                        </div>

                        {!roomSettingsStatus?.kidIsUuid && roomSettingsStatus?.roomRealtimeJwtKid && (
                          <div className="rounded-md border border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950">
                            <p className="font-medium">
                              {t("subApps.roomSecurity.kidInvalidTitle")}
                            </p>
                            <p className="mt-1 text-amber-900">
                              {t("subApps.roomSecurity.kidInvalidDesc")}
                            </p>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <Label>{t("subApps.roomSecurity.kidLabel")}</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                copyValue(
                                  roomSettingsStatus?.roomRealtimeJwtKid,
                                  t("subApps.roomSecurity.copyKidSuccess"),
                                )
                              }
                              disabled={!roomSettingsStatus?.roomRealtimeJwtKid}
                            >
                              <Copy className="mr-1.5 size-3.5" />
                              {t("common.copy")}
                            </Button>
                          </div>
                          <Input value={roomSettingsStatus?.roomRealtimeJwtKid || ""} readOnly />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <Label>{t("subApps.roomSecurity.signingKeyJsonLabel")}</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                copyValue(
                                  roomSettingsStatus?.supabaseImportJwk,
                                  t("subApps.roomSecurity.copySigningKeySuccess"),
                                )
                              }
                              disabled={!roomSettingsStatus?.supabaseImportJwk}
                            >
                              <Copy className="mr-1.5 size-3.5" />
                              {t("common.copy")}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {roomSettingsStatus?.supabaseImportJwk
                              ? t("subApps.roomSecurity.signingKeyJsonHint")
                              : roomSettingsStatus?.roomRealtimeJwtKid && !roomSettingsStatus.kidIsUuid
                                ? t("subApps.roomSecurity.importJsonUnavailableInvalidKid")
                                : t("subApps.roomSecurity.importJsonUnavailable")}
                          </p>
                          <Textarea
                            value={roomSettingsStatus?.supabaseImportJwk || ""}
                            readOnly
                            rows={10}
                            className="font-mono text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <Label>{t("subApps.roomSecurity.publicKeyLabel")}</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                copyValue(
                                  roomSettingsStatus?.publicKeyPem,
                                  t("subApps.roomSecurity.copyPublicKeySuccess"),
                                )
                              }
                              disabled={!roomSettingsStatus?.publicKeyPem}
                            >
                              <Copy className="mr-1.5 size-3.5" />
                              {t("common.copy")}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("subApps.roomSecurity.publicKeyHint")}
                          </p>
                          <Textarea
                            value={roomSettingsStatus?.publicKeyPem || ""}
                            readOnly
                            rows={6}
                            className="font-mono text-xs"
                          />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {t("subApps.roomSecurity.updateTitle")}
                    </CardTitle>
                    <CardDescription>
                      {t("subApps.roomSecurity.updateDesc")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>{t("subApps.roomSecurity.tokenSecretLabel")}</Label>
                      <Input
                        type="password"
                        value={roomSettingsForm.ROOM_TOKEN_SECRET}
                        onChange={(event) =>
                          setRoomSettingsForm((current) => ({
                            ...current,
                            ROOM_TOKEN_SECRET: event.target.value,
                          }))
                        }
                        placeholder={t("subApps.roomSecurity.tokenSecretPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label>{t("subApps.roomSecurity.kidInputLabel")}</Label>
                        <Button type="button" variant="outline" size="sm" onClick={fillGeneratedKid}>
                          {t("subApps.roomSecurity.generateKidButton")}
                        </Button>
                      </div>
                      <Input
                        value={roomSettingsForm.ROOM_REALTIME_JWT_KID}
                        onChange={(event) =>
                          setRoomSettingsForm((current) => ({
                            ...current,
                            ROOM_REALTIME_JWT_KID: event.target.value,
                          }))
                        }
                        placeholder={t("subApps.roomSecurity.kidInputPlaceholder")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("subApps.roomSecurity.kidInputHint")}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("subApps.roomSecurity.privateKeyLabel")}</Label>
                      <Textarea
                        value={roomSettingsForm.ROOM_REALTIME_JWT_PRIVATE_KEY}
                        onChange={(event) =>
                          setRoomSettingsForm((current) => ({
                            ...current,
                            ROOM_REALTIME_JWT_PRIVATE_KEY: event.target.value,
                          }))
                        }
                        rows={8}
                        className="font-mono text-xs"
                        placeholder={t("subApps.roomSecurity.privateKeyPlaceholder")}
                      />
                    </div>

                    <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                        <p>{t("subApps.roomSecurity.rotationWarning")}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-background px-6 py-4">
            {settingsTarget?.slug === "room" && (
              <Button
                type="button"
                variant="outline"
                onClick={generateRoomSettings}
                disabled={settingsSaving}
              >
                <RefreshCw className="mr-2 size-4" />
                {t("subApps.roomSecurity.generateButton")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSettingsDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveRoomSettings}
              disabled={settingsSaving || settingsTarget?.slug !== "room"}
            >
              {settingsSaving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bindDialogOpen} onOpenChange={setBindDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("subApps.bindAgents")}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t("subApps.bindAgentsDesc")}
            </p>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {agents.map((agent) => (
              <label
                key={agent.id}
                className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent transition-colors"
              >
                <Checkbox
                  checked={boundAgentIds.includes(agent.id)}
                  onCheckedChange={() => toggleAgent(agent.id)}
                />
                <div className="flex items-center gap-2 min-w-0">
                  <Bot className="size-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{agent.name}</span>
                </div>
              </label>
            ))}
            {agents.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                {t("common.noData")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleBindSave} disabled={bindSaving}>
              {bindSaving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
