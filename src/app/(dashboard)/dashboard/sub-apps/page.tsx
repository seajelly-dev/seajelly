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
}

interface RoomSettingsStatus {
  complete: boolean;
  configuredKeys: string[];
  missingKeys: string[];
  publicKeyPem: string | null;
  roomRealtimeJwtKid: string | null;
  supabaseImportJwk: string | null;
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
        A <strong>Sub-App</strong> is SEAJelly&apos;s Agent-Native GUI interaction paradigm. Unlike Skills (text injection into system prompts) or MCP Servers (tool protocol extensions), a Sub-App provides a <strong>visual web interface</strong> that agents can create and share via IM links.
      </p>
      <p>The core flow:</p>
      <ol>
        <li>Agent receives a command or semantic trigger</li>
        <li>Agent calls a tool to create an instance (e.g., a chatroom, poll, whiteboard)</li>
        <li>A unique URL with a <strong>signed token</strong> is generated and <strong>directly sent</strong> to IM channels</li>
        <li>Users open the link — identity is auto-recognized from the token, no login required</li>
        <li>The agent can participate in real-time via the same interface</li>
      </ol>

      <h2>Directory &amp; Routing Conventions</h2>
      <CodeBlock>{`Frontend page:  src/app/app/{slug}/[id]/page.tsx   →  /app/{slug}/{instance-id}
Backend API:    src/app/api/app/{slug}/route.ts     →  /api/app/{slug}
Database:       {slug}_* tables                     →  e.g., chat_rooms, chat_room_messages
Agent tools:    src/lib/agent/tools.ts              →  createSubAppTools()
Shared tooling: src/lib/agent/tooling/*             →  policy, toolkit, runtime resolution
Token utils:    src/lib/room-token.ts               →  signRoomToken(), verifyRoomToken(), buildRoomUrl()`}</CodeBlock>
      <p>The <code>slug</code> is a short, URL-safe identifier registered in the <code>sub_apps</code> table (e.g., <code>room</code>, <code>poll</code>, <code>board</code>).</p>

      <h2>Development Checklist</h2>

      <h3>1. Register in <code>sub_apps</code> table</h3>
      <p>Add an <code>INSERT</code> statement to <code>supabase/migrations/001_initial_schema.sql</code>:</p>
      <CodeBlock>{`INSERT INTO public.sub_apps (slug, name, description, tool_names, enabled)
VALUES ('your-slug', 'Your App Name', 'Description', ARRAY['tool_name_1', 'tool_name_2'], true)
ON CONFLICT (slug) DO NOTHING;`}</CodeBlock>

      <h3>2. Create data tables</h3>
      <CodeBlock>{`CREATE TABLE IF NOT EXISTS public.your_slug_instances (
  id          text PRIMARY KEY DEFAULT encode(gen_random_bytes(8), 'hex'),
  agent_id    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);`}</CodeBlock>
      <p><strong>RLS policies</strong> — follow the standard pattern:</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Role</th><th>Policy</th></tr></thead>
          <tbody>
            <tr><td><code>anon</code></td><td><code>SELECT</code> (and <code>INSERT</code> if users post data from the public page)</td></tr>
            <tr><td><code>authenticated</code> / admin</td><td><code>ALL</code> via <code>public.is_admin()</code></td></tr>
            <tr><td><code>service_role</code></td><td><code>ALL</code></td></tr>
          </tbody>
        </table>
      </div>
      <p><strong>Realtime</strong> — if your Sub-App needs real-time updates:</p>
      <CodeBlock>{`DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'your_table_name'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.your_table_name;
  END IF;
END $$;`}</CodeBlock>

      <h3>3. Sync schema</h3>
      <p>After modifying <code>001_initial_schema.sql</code>, copy the exact same SQL block into <code>src/app/api/admin/setup/route.ts</code> inside the <code>SCHEMA_SQL</code> template literal. Apply immediately via the Supabase MCP <code>execute_sql</code> tool.</p>

      <h3>4. Add TypeScript types</h3>
      <p>In <code>src/types/database.ts</code>:</p>
      <CodeBlock>{`export interface YourInstance {
  id: string;
  agent_id: string;
  status: string;
  created_at: string;
}`}</CodeBlock>

      <h3>5. Create Agent tools — Critical Rules</h3>
      <p>In <code>src/lib/agent/tools.ts</code>, add tools inside <code>createSubAppTools()</code>.</p>

      <h4>Rule 1: Tools MUST send messages directly — never delegate to AI</h4>
      <p>The AI may hallucinate, modify URLs, or generate HTML prototypes. All user-facing output (especially URLs) must be sent directly by the tool via <code>sender.sendMarkdown()</code>:</p>
      <CodeBlock>{`create_something: tool({
  description: "Create a new instance. IMPORTANT: The tool handles all user communication directly.",
  inputSchema: z.object({ title: z.string().optional() }),
  execute: async ({ title }: { title?: string }) => {
    if (!isOwner) {
      await sendToCurrent(t("ownerOnly"));
      return { success: false, error: "owner_only" };
    }
    const url = buildUrl(instanceId, channelId, platform, displayName, true);
    if (sender && platformChatId) {
      await sender.sendMarkdown(platformChatId, t("instanceCreated", { title, url }));
    }
    return { success: true, url, title };
  },
}),`}</CodeBlock>

      <h4>Rule 2: All tool messages MUST be internationalized</h4>
      <p>Tools receive <code>locale</code> and must use <code>botT()</code> for every user-visible string:</p>
      <CodeBlock>{`export function createSubAppTools({ agentId, channelId, isOwner, sender, platformChatId, platform, locale }: ToolsOptions) {
  const botLocale = getBotLocaleOrDefault(locale);
  const t = (k, p?) => botT(botLocale, k, p);
  const sendToCurrent = async (message: string) => {
    if (sender && platformChatId) await sender.sendMarkdown(platformChatId, message);
  };
}`}</CodeBlock>

      <h4>Rule 3: Use real user identity, never hardcode</h4>
      <p>Resolve the actual display name from the channel — never use <code>&quot;Owner&quot;</code> or any placeholder:</p>
      <CodeBlock>{`async function getChannelDisplayName(): Promise<string> {
  if (!channelId) return "User";
  const { data } = await supabase
    .from("channels")
    .select("display_name, platform_uid")
    .eq("id", channelId)
    .single();
  return data?.display_name || data?.platform_uid || "User";
}`}</CodeBlock>

      <h4>Rule 4: Use Markdown explicit link syntax for IM messages</h4>
      <p>Long URLs with query parameters are often not auto-linked by IM platforms. Always use <code>[Link Text](url)</code> in bot messages.</p>

      <h3>6. Configure AI behavior in shared tooling runtime</h3>
      <p>
        Add Sub-App tool policy to <code>src/lib/agent/tooling/runtime.ts</code> via <code>buildToolPolicySections()</code>. Do not hardcode new policy text directly in <code>src/lib/agent/loop.ts</code>. If you are creating a builtin toolkit rather than a Sub-App tool, put the policy in <code>src/lib/agent/tooling/toolkits/&#123;name&#125;.ts</code> instead. See <code>src/lib/agent/tooling/README.md</code> for the architecture rules.
      </p>
      <CodeBlock>{`if (toolNames.has("create_something")) {
  sections.push(
    "## Your-App Tool Policy\\n" +
    "- If user asks to create/open/start an instance, you MUST call \`create_something\`.\\n" +
    "- Never generate HTML prototypes or fake links.\\n" +
    "- After a tool succeeds, do not invent additional links or duplicate messages.",
  );
}`}</CodeBlock>
      <p><strong>Suppress AI output</strong> when tools handle communication directly:</p>
      <CodeBlock>{`const calledToolNames = extractToolNamesFromResult(result);
const toolHandledOutput = calledToolNames.has("create_something");
const reply = toolHandledOutput ? "" : (result.text || t("noResponseGenerated"));
if (!toolHandledOutput) {
  await sender.sendMarkdown(platformChatId, reply);
}`}</CodeBlock>

      <h3>7. Create backend API</h3>
      <p><code>src/app/api/app/&#123;slug&#125;/route.ts</code>: <strong>GET</strong> (fetch data), <strong>POST</strong> (user actions), <strong>PATCH</strong> (owner actions).</p>

      <h4>Vercel serverless requirements</h4>
      <CodeBlock>{`export const runtime = "nodejs";  // MANDATORY for after()
export const maxDuration = 60;`}</CodeBlock>
      <p><code>runtime = &quot;nodejs&quot;</code> is <strong>mandatory</strong> if you use <code>after()</code>. Without it, <code>after()</code> callbacks are silently dropped in Vercel&apos;s Edge runtime.</p>

      <h4>Token-based authentication</h4>
      <CodeBlock>{`import { verifyRoomToken } from "@/lib/room-token";

export async function POST(req: NextRequest) {
  const { token: tokenStr, content } = await req.json();
  const token = verifyRoomToken(tokenStr);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { r: roomId, n: displayName, p: platform, o: isOwner } = token;
}`}</CodeBlock>

      <h4>Async agent replies with <code>after()</code></h4>
      <CodeBlock>{`import { after } from "next/server";

after(async () => {
  try {
    await runAgentLoop({ /* ... */ });
  } catch (e) {
    console.error("Agent reply failed:", e);
  }
});
return NextResponse.json({ success: true });`}</CodeBlock>

      <h4>@mention detection</h4>
      <p>Support both <code>@agent</code> and the agent&apos;s actual name (including Chinese names):</p>
      <CodeBlock>{`const normalized = content.trim();
const aliasMentioned = /@agent(?=$|\\s|[,.!?，。！？:：;；])/i.test(normalized);
const nameMentioned = normalized.includes(\`@\${agentName}\`);
const mentionsAgent = aliasMentioned || nameMentioned;`}</CodeBlock>

      <h3>8. Create frontend page</h3>
      <p><code>src/app/app/&#123;slug&#125;/[id]/page.tsx</code>:</p>
      <ul>
        <li><strong>Token-based auto-identity</strong>: Parse <code>?t=</code> query parameter to auto-fill nickname, platform, and owner status</li>
        <li>Use <code>createClient()</code> from <code>@/lib/supabase/client</code> for Realtime subscriptions</li>
        <li>Subscribe to <code>postgres_changes</code> for real-time updates</li>
        <li>Use Presence for online user tracking</li>
      </ul>
      <p><strong>Owner UX:</strong> Display badge next to owner name, show owner-only controls (close/reopen), highlight avatar with gold ring.</p>
      <p><strong>Agent interaction UX:</strong> One-click <code>@&#123;agentName&#125;</code> button, dynamic placeholder, auto-insert mention on click.</p>
      <p><strong>i18n:</strong> Use <code>useI18n()</code> hook, add language switcher in header.</p>

      <h3>9. Add i18n strings</h3>
      <p><code>en.ts</code>, <code>zh.ts</code> for UI text; <code>bot.ts</code> for IM bot messages. Bot messages with URLs <strong>must</strong> use <code>[text](url)</code> Markdown syntax.</p>

      <h3>10. (Optional) Add IM command</h3>
      <p>In <code>src/lib/agent/loop.ts</code>, add a command handler. Update <code>buildHelpText()</code> and <code>buildWelcomeText()</code> in <code>bot.ts</code>.</p>

      <h2>Authentication Model</h2>
      <h3>Signed Token (recommended)</h3>
      <p>URL-only-ID is <strong>insecure</strong>. Use <strong>HMAC-SHA256 signed tokens</strong>:</p>
      <CodeBlock>{`/app/{slug}/{id}?t={base64url_payload}.{base64url_signature}`}</CodeBlock>
      <p>Token payload: <code>r</code> (instance ID), <code>c</code> (channel ID), <code>p</code> (platform), <code>n</code> (display name), <code>o</code> (is owner), <code>iat</code> (issued-at). Implementation: <code>src/lib/room-token.ts</code>.</p>

      <h3>URL construction priority</h3>
      <ol>
        <li><code>NEXT_PUBLIC_APP_URL</code> (custom domain, highest priority)</li>
        <li><code>VERCEL_PROJECT_PRODUCTION_URL</code> (Vercel custom domain)</li>
        <li><code>VERCEL_URL</code> (Vercel native URL, fallback)</li>
        <li><code>localhost:3000</code> (local dev)</li>
      </ol>
      <p><strong>Never hardcode or concatenate URLs manually in tools.</strong></p>

      <h2>Pitfalls &amp; Lessons Learned</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">AI will hallucinate if you let it</h4>
          <p className="text-sm mb-1">If a tool returns a URL and expects the AI to relay it, the AI may modify/truncate the URL, generate HTML prototypes, or duplicate messages.</p>
          <p className="text-sm font-medium">Solution: Tools send messages directly via <code>sender.sendMarkdown()</code>. Suppress AI text output after tool execution.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">IM platforms don&apos;t auto-link long URLs</h4>
          <p className="text-sm font-medium">Solution: Always use <code>[Link Text](url)</code> Markdown syntax in bot messages.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1"><code>after()</code> silently fails without <code>runtime = &quot;nodejs&quot;</code></h4>
          <p className="text-sm font-medium">Solution: Always add <code>export const runtime = &quot;nodejs&quot;</code> to API routes that use <code>after()</code>.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">@mention detection must handle real names</h4>
          <p className="text-sm mb-1"><code>/@agent\b/</code> doesn&apos;t work with Chinese names (no word boundaries in CJK).</p>
          <p className="text-sm font-medium">Solution: Check both <code>@agent</code> (with delimiter lookahead) and <code>@&#123;actualAgentName&#125;</code> (substring match).</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Hardcoded identity breaks UX</h4>
          <p className="text-sm font-medium">Solution: Resolve real display name from <code>channels</code> table. Never use role labels like &quot;Owner&quot;.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Turbopack dev server can freeze your machine</h4>
          <p className="text-sm font-medium">Solution: Set <code>turbopack.root: process.cwd()</code> in <code>next.config.ts</code>.</p>
        </div>
      </div>

      <h2>Reference Implementation: Chatroom</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Layer</th><th>File</th></tr></thead>
          <tbody>
            <tr><td>Database</td><td><code>001_initial_schema.sql</code> — <code>chat_rooms</code>, <code>chat_room_messages</code></td></tr>
            <tr><td>Types</td><td><code>src/types/database.ts</code> — <code>ChatRoom</code>, <code>ChatRoomMessage</code></td></tr>
            <tr><td>Token</td><td><code>src/lib/room-token.ts</code></td></tr>
            <tr><td>Agent tools</td><td><code>src/lib/agent/tools.ts</code> — <code>create_chat_room</code>, <code>close_chat_room</code>, <code>reopen_chat_room</code></td></tr>
            <tr><td>IM command</td><td><code>src/lib/agent/loop.ts</code> — <code>/room</code></td></tr>
            <tr><td>Backend API</td><td><code>src/app/api/app/room/route.ts</code> — GET/POST/PATCH</td></tr>
            <tr><td>Frontend</td><td><code>src/app/app/room/[id]/page.tsx</code></td></tr>
            <tr><td>Admin</td><td><code>src/app/(dashboard)/dashboard/sub-apps/page.tsx</code></td></tr>
            <tr><td>i18n</td><td><code>en.ts</code>, <code>zh.ts</code>, <code>bot.ts</code></td></tr>
          </tbody>
        </table>
      </div>

      <h2>Sub-App Ideas for Future Development</h2>
      <ul>
        <li><strong>Poll</strong> (<code>/app/poll/[id]</code>) — real-time voting with live result visualization</li>
        <li><strong>Whiteboard</strong> (<code>/app/board/[id]</code>) — collaborative drawing/notes</li>
        <li><strong>Form</strong> (<code>/app/form/[id]</code>) — data collection with agent-generated forms</li>
        <li><strong>Dashboard</strong> (<code>/app/dash/[id]</code>) — real-time metrics/monitoring view</li>
        <li><strong>Gallery</strong> (<code>/app/gallery/[id]</code>) — shared image/file collection</li>
      </ul>
    </article>
  );
}

function DevGuideZh() {
  return (
    <article className={article}>
      <h2>什么是 Sub-App？</h2>
      <p>
        <strong>Sub-App</strong> 是 SEAJelly 的 <strong>Agent 原生 GUI 交互范式</strong>。与 Skill（文本注入系统提示词）或 MCP Server（工具协议扩展）不同，Sub-App 提供的是<strong>可视化 Web 交互界面</strong>——Agent 通过工具创建界面，通过 IM 发送链接，用户打开链接即进入 GUI 体验。
      </p>
      <p>核心流程：</p>
      <ol>
        <li>Agent 收到命令或语义触发</li>
        <li>Agent 调用工具创建实例（如聊天室、投票、白板）</li>
        <li>生成带<strong>签名 Token</strong> 的唯一 URL，<strong>由工具直接发送</strong>到 IM 频道</li>
        <li>用户打开链接——身份从 Token 自动识别，无需登录</li>
        <li>Agent 可通过同一界面实时参与</li>
      </ol>

      <h2>目录与路由约定</h2>
      <CodeBlock>{`前端页面:    src/app/app/{slug}/[id]/page.tsx   →  /app/{slug}/{实例ID}
后端 API:    src/app/api/app/{slug}/route.ts     →  /api/app/{slug}
数据表:      {slug}_* 表                         →  如 chat_rooms, chat_room_messages
Agent 工具:  src/lib/agent/tools.ts              →  createSubAppTools()
Shared tooling: src/lib/agent/tooling/*          →  策略、toolkit、运行时解析
Token 工具:  src/lib/room-token.ts               →  signRoomToken(), verifyRoomToken(), buildRoomUrl()`}</CodeBlock>
      <p><code>slug</code> 是注册在 <code>sub_apps</code> 表中的短标识符，需 URL 安全（如 <code>room</code>、<code>poll</code>、<code>board</code>）。</p>

      <h2>开发步骤清单</h2>

      <h3>1. 在 <code>sub_apps</code> 表中注册</h3>
      <p>在 <code>supabase/migrations/001_initial_schema.sql</code> 末尾添加：</p>
      <CodeBlock>{`INSERT INTO public.sub_apps (slug, name, description, tool_names, enabled)
VALUES ('your-slug', '应用名称', '应用描述', ARRAY['tool_name_1', 'tool_name_2'], true)
ON CONFLICT (slug) DO NOTHING;`}</CodeBlock>

      <h3>2. 创建数据表</h3>
      <CodeBlock>{`CREATE TABLE IF NOT EXISTS public.your_slug_instances (
  id          text PRIMARY KEY DEFAULT encode(gen_random_bytes(8), 'hex'),
  agent_id    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);`}</CodeBlock>
      <p><strong>RLS 策略</strong>——遵循标准模式：</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>角色</th><th>策略</th></tr></thead>
          <tbody>
            <tr><td><code>anon</code></td><td><code>SELECT</code>（如用户需从公开页面提交数据，则加 <code>INSERT</code>）</td></tr>
            <tr><td><code>authenticated</code> / admin</td><td><code>ALL</code>，通过 <code>public.is_admin()</code></td></tr>
            <tr><td><code>service_role</code></td><td><code>ALL</code></td></tr>
          </tbody>
        </table>
      </div>
      <p><strong>Realtime</strong>——如需实时更新：</p>
      <CodeBlock>{`DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'your_table_name'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.your_table_name;
  END IF;
END $$;`}</CodeBlock>

      <h3>3. 同步 Schema</h3>
      <p>修改 <code>001_initial_schema.sql</code> 后，将完全相同的 SQL 块复制到 <code>src/app/api/admin/setup/route.ts</code> 的 <code>SCHEMA_SQL</code> 模板字符串中。通过 Supabase MCP 的 <code>execute_sql</code> 工具立即应用。</p>

      <h3>4. 添加 TypeScript 类型</h3>
      <p>在 <code>src/types/database.ts</code> 中：</p>
      <CodeBlock>{`export interface YourInstance {
  id: string;
  agent_id: string;
  status: string;
  created_at: string;
}`}</CodeBlock>

      <h3>5. 创建 Agent 工具——关键规则</h3>
      <p>在 <code>src/lib/agent/tools.ts</code> 的 <code>createSubAppTools()</code> 函数中添加工具。</p>

      <h4>规则一：工具必须直接发送消息——绝不交给 AI 中转</h4>
      <p>AI 可能会篡改 URL、生成 HTML 原型、或产生幻觉内容。所有面向用户的输出（尤其是 URL）必须由工具通过 <code>sender.sendMarkdown()</code> 直接发送：</p>
      <CodeBlock>{`create_something: tool({
  description: "创建新实例。重要：工具直接处理所有用户通信。",
  inputSchema: z.object({ title: z.string().optional() }),
  execute: async ({ title }: { title?: string }) => {
    if (!isOwner) {
      await sendToCurrent(t("ownerOnly"));
      return { success: false, error: "owner_only" };
    }
    const url = buildUrl(instanceId, channelId, platform, displayName, true);
    if (sender && platformChatId) {
      await sender.sendMarkdown(platformChatId, t("instanceCreated", { title, url }));
    }
    return { success: true, url, title };
  },
}),`}</CodeBlock>

      <h4>规则二：工具消息必须国际化</h4>
      <p>工具接收 <code>locale</code> 参数，所有用户可见的字符串必须使用 <code>botT()</code>：</p>
      <CodeBlock>{`export function createSubAppTools({ agentId, channelId, isOwner, sender, platformChatId, platform, locale }: ToolsOptions) {
  const botLocale = getBotLocaleOrDefault(locale);
  const t = (k, p?) => botT(botLocale, k, p);
  const sendToCurrent = async (message: string) => {
    if (sender && platformChatId) await sender.sendMarkdown(platformChatId, message);
  };
}`}</CodeBlock>

      <h4>规则三：使用真实用户身份，禁止硬编码</h4>
      <p>生成 URL 或记录所有权时，必须从 channel 解析真实的显示名称——绝不使用 <code>&quot;Owner&quot;</code> 等占位符：</p>
      <CodeBlock>{`async function getChannelDisplayName(): Promise<string> {
  if (!channelId) return "User";
  const { data } = await supabase
    .from("channels")
    .select("display_name, platform_uid")
    .eq("id", channelId)
    .single();
  return data?.display_name || data?.platform_uid || "User";
}`}</CodeBlock>

      <h4>规则四：IM 消息中使用 Markdown 显式链接语法</h4>
      <p>带查询参数的长 URL 在 IM 平台（Telegram、飞书等）中经常无法自动识别为可点击链接。必须使用 <code>[链接文本](url)</code>。</p>

      <h3>6. 在共享 tooling runtime 中配置 AI 行为</h3>
      <p>
        Sub-App 的工具策略应添加到 <code>src/lib/agent/tooling/runtime.ts</code> 的 <code>buildToolPolicySections()</code> 中，不要再把新的策略文案直接硬编码进 <code>src/lib/agent/loop.ts</code>。如果你做的是 builtin toolkit，而不是 Sub-App 工具，则把策略写到 <code>src/lib/agent/tooling/toolkits/&#123;name&#125;.ts</code>。整体架构说明见 <code>src/lib/agent/tooling/README.md</code>。
      </p>
      <CodeBlock>{`if (toolNames.has("create_something")) {
  sections.push(
    "## Your-App Tool Policy\\n" +
    "- If user asks to create/open/start an instance, you MUST call \`create_something\`.\\n" +
    "- Never generate HTML prototypes or fake links.\\n" +
    "- After a tool succeeds, do not invent additional links or duplicate messages.",
  );
}`}</CodeBlock>
      <p><strong>工具直接发送消息后，抑制 AI 的默认输出：</strong></p>
      <CodeBlock>{`const calledToolNames = extractToolNamesFromResult(result);
const toolHandledOutput = calledToolNames.has("create_something");
const reply = toolHandledOutput ? "" : (result.text || t("noResponseGenerated"));
if (!toolHandledOutput) {
  await sender.sendMarkdown(platformChatId, reply);
}`}</CodeBlock>

      <h3>7. 创建后端 API</h3>
      <p><code>src/app/api/app/&#123;slug&#125;/route.ts</code>：<strong>GET</strong>（获取数据）、<strong>POST</strong>（用户操作）、<strong>PATCH</strong>（实控人操作）。</p>

      <h4>Vercel Serverless 必要配置</h4>
      <CodeBlock>{`export const runtime = "nodejs";  // 使用 after() 时必须设置
export const maxDuration = 60;`}</CodeBlock>
      <p>如果使用 <code>after()</code> 处理异步任务，<code>runtime = &quot;nodejs&quot;</code> 是<strong>必须的</strong>。没有它，<code>after()</code> 回调在 Vercel 的 Edge Runtime 中会被静默丢弃。</p>

      <h4>基于 Token 的认证</h4>
      <CodeBlock>{`import { verifyRoomToken } from "@/lib/room-token";

export async function POST(req: NextRequest) {
  const { token: tokenStr, content } = await req.json();
  const token = verifyRoomToken(tokenStr);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { r: roomId, n: displayName, p: platform, o: isOwner } = token;
}`}</CodeBlock>

      <h4>使用 <code>after()</code> 处理异步 Agent 回复</h4>
      <CodeBlock>{`import { after } from "next/server";

after(async () => {
  try {
    await runAgentLoop({ /* ... */ });
  } catch (e) {
    console.error("Agent reply failed:", e);
  }
});
return NextResponse.json({ success: true });`}</CodeBlock>

      <h4>@提及检测</h4>
      <p>需同时支持通用的 <code>@agent</code> 关键词和 Agent 的真实名字（包括中文名）：</p>
      <CodeBlock>{`const normalized = content.trim();
const aliasMentioned = /@agent(?=$|\\s|[,.!?，。！？:：;；])/i.test(normalized);
const nameMentioned = normalized.includes(\`@\${agentName}\`);
const mentionsAgent = aliasMentioned || nameMentioned;`}</CodeBlock>

      <h3>8. 创建前端页面</h3>
      <p><code>src/app/app/&#123;slug&#125;/[id]/page.tsx</code>：</p>
      <ul>
        <li><strong>Token 自动识别身份</strong>：解析 URL 中的 <code>?t=</code> 参数，自动填充昵称、平台和实控人状态</li>
        <li>使用 <code>@/lib/supabase/client</code> 的 <code>createClient()</code> 订阅 Realtime</li>
        <li>订阅 <code>postgres_changes</code> 获取实时更新</li>
        <li>使用 Presence 追踪在线用户</li>
      </ul>
      <p><strong>实控人体验：</strong>在实控人名字旁显示标记（盾牌图标），头部显示专属控制按钮（关闭/重启），在线列表中高亮头像（金色边框）。</p>
      <p><strong>Agent 交互体验：</strong>一键 <code>@&#123;agentName&#125;</code> 按钮，动态占位符，点击自动插入提及。</p>
      <p><strong>国际化：</strong>使用 <code>useI18n()</code> Hook，在页面头部添加语言切换按钮。</p>

      <h3>9. 添加国际化文案</h3>
      <p><code>en.ts</code>、<code>zh.ts</code> 用于 UI 文本；<code>bot.ts</code> 用于 IM 机器人消息。包含 URL 的 Bot 消息<strong>必须</strong>使用 <code>[文本](url)</code> Markdown 语法。</p>

      <h3>10.（可选）添加 IM 命令</h3>
      <p>在 <code>src/lib/agent/loop.ts</code> 中添加命令处理器。同步更新 <code>bot.ts</code> 中的 <code>buildHelpText()</code> 和 <code>buildWelcomeText()</code>。</p>

      <h2>鉴权模型</h2>
      <h3>签名 Token（推荐）</h3>
      <p>仅靠 URL ID 是<strong>不安全的</strong>。使用 <strong>HMAC-SHA256 签名 Token</strong> 携带已验证的身份：</p>
      <CodeBlock>{`/app/{slug}/{id}?t={base64url_payload}.{base64url_signature}`}</CodeBlock>
      <p>Token 载荷：<code>r</code>（实例 ID）、<code>c</code>（频道 ID）、<code>p</code>（平台）、<code>n</code>（显示名称）、<code>o</code>（是否实控人）、<code>iat</code>（签发时间戳）。实现参考：<code>src/lib/room-token.ts</code>。</p>

      <h3>URL 构造优先级</h3>
      <ol>
        <li><code>NEXT_PUBLIC_APP_URL</code>（自定义域名，最高优先级）</li>
        <li><code>VERCEL_PROJECT_PRODUCTION_URL</code>（Vercel 自定义域名）</li>
        <li><code>VERCEL_URL</code>（Vercel 原生 URL，兜底）</li>
        <li><code>localhost:3000</code>（本地开发）</li>
      </ol>
      <p><strong>绝不在工具中手动硬编码或拼接 URL。</strong></p>

      <h2>踩坑记录与经验教训</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">AI 会产生幻觉——如果你放任它</h4>
          <p className="text-sm mb-1">如果工具返回 URL 并期望 AI 转发，AI 可能会修改/截断 URL、生成 HTML 原型、或用虚构内容重复发送消息。</p>
          <p className="text-sm font-medium">解决方案：工具通过 <code>sender.sendMarkdown()</code> 直接发送消息。工具执行后抑制 AI 的文本输出。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">IM 平台不会自动识别长 URL</h4>
          <p className="text-sm font-medium">解决方案：Bot 消息中始终使用 <code>[链接文本](url)</code> Markdown 语法。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1"><code>after()</code> 在没有 <code>runtime = &quot;nodejs&quot;</code> 时静默失效</h4>
          <p className="text-sm font-medium">解决方案：使用 <code>after()</code> 的 API 路由必须添加 <code>export const runtime = &quot;nodejs&quot;</code>。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">@提及检测必须支持真实名字</h4>
          <p className="text-sm mb-1"><code>/@agent\b/</code> 在 Agent 使用中文名时不起作用（CJK 字符没有词边界）。</p>
          <p className="text-sm font-medium">解决方案：同时检查 <code>@agent</code>（带分隔符前瞻）和 <code>@&#123;实际Agent名&#125;</code>（子串匹配）。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">硬编码身份破坏用户体验</h4>
          <p className="text-sm font-medium">解决方案：从 <code>channels</code> 表解析真实显示名称。绝不使用 &quot;Owner&quot; 等角色标签。</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="text-destructive font-semibold mb-1">Turbopack 开发服务器可能卡死你的机器</h4>
          <p className="text-sm font-medium">解决方案：在 <code>next.config.ts</code> 中设置 <code>turbopack.root: process.cwd()</code>。</p>
        </div>
      </div>

      <h2>参考实现：聊天室（Chatroom）</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>层级</th><th>文件</th></tr></thead>
          <tbody>
            <tr><td>数据库</td><td><code>001_initial_schema.sql</code> — <code>chat_rooms</code>、<code>chat_room_messages</code></td></tr>
            <tr><td>类型</td><td><code>src/types/database.ts</code> — <code>ChatRoom</code>、<code>ChatRoomMessage</code></td></tr>
            <tr><td>Token</td><td><code>src/lib/room-token.ts</code></td></tr>
            <tr><td>Agent 工具</td><td><code>src/lib/agent/tools.ts</code> — <code>create_chat_room</code>、<code>close_chat_room</code>、<code>reopen_chat_room</code></td></tr>
            <tr><td>IM 命令</td><td><code>src/lib/agent/loop.ts</code> — <code>/room</code></td></tr>
            <tr><td>后端 API</td><td><code>src/app/api/app/room/route.ts</code> — GET/POST/PATCH</td></tr>
            <tr><td>前端页面</td><td><code>src/app/app/room/[id]/page.tsx</code></td></tr>
            <tr><td>管理后台</td><td><code>src/app/(dashboard)/dashboard/sub-apps/page.tsx</code></td></tr>
            <tr><td>国际化</td><td><code>en.ts</code>、<code>zh.ts</code>、<code>bot.ts</code></td></tr>
          </tbody>
        </table>
      </div>

      <h2>未来 Sub-App 方向</h2>
      <ul>
        <li><strong>投票</strong>（<code>/app/poll/[id]</code>）— 实时投票 + 结果可视化</li>
        <li><strong>白板</strong>（<code>/app/board/[id]</code>）— 协作绘图/笔记</li>
        <li><strong>表单</strong>（<code>/app/form/[id]</code>）— Agent 生成的数据收集表单</li>
        <li><strong>仪表盘</strong>（<code>/app/dash/[id]</code>）— 实时指标/监控视图</li>
        <li><strong>画廊</strong>（<code>/app/gallery/[id]</code>）— 共享图片/文件集合</li>
      </ul>
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
                      <Label>{t("subApps.roomSecurity.kidInputLabel")}</Label>
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
