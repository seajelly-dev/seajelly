"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Lock,
  Globe,
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
  Settings2,
  Copy,
  Zap,
  ArrowLeft,
  User,
} from "lucide-react";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import type { Agent, McpServer, Skill, Provider, KnowledgeBase } from "@/types/database";
import type { ModelDef } from "@/lib/models";

const PRIVILEGED_TOOLS = [
  { key: "knowledge_search", label: "knowledge_search", desc: "agents.toolKnowledgeSearch", defaultOn: false },
  { key: "run_sql", label: "run_sql", desc: "agents.toolRunSql", defaultOn: false },
  { key: "schedule_task", label: "schedule_task", desc: "agents.toolScheduleTask", defaultOn: true },
  { key: "cancel_scheduled_job", label: "cancel_scheduled_job", desc: "agents.toolCancelJob", defaultOn: true },
  { key: "list_scheduled_jobs", label: "list_scheduled_jobs", desc: "agents.toolListJobs", defaultOn: true },
  { key: "run_python_code", label: "run_python_code", desc: "coding.toolRunPython", defaultOn: false },
  { key: "run_javascript_code", label: "run_javascript_code", desc: "coding.toolRunJS", defaultOn: false },
  { key: "run_html_preview", label: "run_html_preview", desc: "coding.toolRunHTML", defaultOn: false },
  { key: "github_read_file", label: "github_read_file", desc: "coding.toolGitHubReadFile", defaultOn: false },
  { key: "github_list_files", label: "github_list_files", desc: "coding.toolGitHubListFiles", defaultOn: false },
  { key: "github_build_verify", label: "github_build_verify", desc: "coding.toolGitHubBuildVerify", defaultOn: false },
  { key: "github_build_status", label: "github_build_status", desc: "coding.toolGitHubBuildStatus", defaultOn: false },
  { key: "github_request_push_approval", label: "github_request_push_approval", desc: "coding.toolGitHubRequestPushApproval", defaultOn: false },
  { key: "github_push_approval_status", label: "github_push_approval_status", desc: "coding.toolGitHubPushApprovalStatus", defaultOn: false },
  { key: "github_commit_push", label: "github_commit_push", desc: "coding.toolGitHubCommitPush", defaultOn: false },
  { key: "tts_speak", label: "tts_speak", desc: "coding.toolTtsSpeak", defaultOn: false },
  { key: "image_generate", label: "image_generate", desc: "coding.toolImageGenerate", defaultOn: false },
] as const;

type PlatformKey = "telegram" | "feishu" | "wecom" | "slack" | "qqbot" | "whatsapp";

interface PlatformDef {
  key: PlatformKey;
  label: string;
  icon: React.FC<{ className?: string }>;
  fields: { name: string; label: string; secret: boolean }[];
}

const PLATFORMS: PlatformDef[] = [
  {
    key: "telegram",
    label: "Telegram",
    icon: TelegramIcon,
    fields: [{ name: "bot_token", label: "Bot Token", secret: true }],
  },
  {
    key: "feishu",
    label: "Feishu / 飞书",
    icon: FeishuIcon,
    fields: [
      { name: "app_id", label: "App ID", secret: true },
      { name: "app_secret", label: "App Secret", secret: true },
      { name: "encrypt_key", label: "Encrypt Key (optional)", secret: true },
    ],
  },
  {
    key: "wecom",
    label: "WeCom / 企业微信",
    icon: WeComIcon,
    fields: [
      { name: "corp_id", label: "Corp ID", secret: true },
      { name: "corp_secret", label: "Corp Secret", secret: true },
      { name: "agent_id", label: "Agent ID", secret: false },
      { name: "token", label: "Token", secret: true },
      { name: "encoding_aes_key", label: "EncodingAESKey", secret: true },
    ],
  },
  {
    key: "slack",
    label: "Slack",
    icon: SlackIcon,
    fields: [
      { name: "bot_token", label: "Bot Token", secret: true },
      { name: "signing_secret", label: "Signing Secret", secret: true },
    ],
  },
  {
    key: "qqbot",
    label: "QQ Bot",
    icon: QQBotIcon,
    fields: [
      { name: "app_id", label: "AppID", secret: false },
      { name: "app_secret", label: "AppSecret", secret: true },
    ],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppIcon,
    fields: [
      { name: "access_token", label: "Access Token", secret: true },
      { name: "phone_number_id", label: "Phone Number ID", secret: false },
      { name: "verify_token", label: "Verify Token", secret: true },
    ],
  },
];

const PLATFORM_HINT_KEYS: Record<PlatformKey, string> = {
  telegram: "hintTelegram",
  feishu: "hintFeishu",
  wecom: "hintWecom",
  slack: "hintSlack",
  qqbot: "hintQqbot",
  whatsapp: "hintWhatsapp",
};

function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return origin;
}

const DEFAULT_SYSTEM_PROMPT = `You are Jelly, a personal AI assistant powered by SEAJelly (Self Evolution Agent Jelly) — a serverless, self-evolving AI agent framework at seaJelly.ai.

## Core Behavior
- Respond in the same language the user writes in. Default to Chinese if ambiguous.
- Be concise and direct. Avoid filler phrases. Get to the point.
- When unsure, ask a clarifying question rather than guessing.
- Use markdown formatting for structured replies (lists, code blocks, etc.).

## Memory & Identity
You have persistent memory across conversations. Use it wisely:
- Use \`memory_write\` to save important facts, user preferences, and decisions. Always write self-contained entries.
- Use \`memory_search\` to recall past context before answering questions about previous conversations.
- Use \`user_soul_update\` when the user tells you their name, preferences, or personal traits. This builds their profile.
- Use \`ai_soul_update\` when the user gives you a name, persona, or character instructions. This defines who you are.
- Do NOT save trivial or ephemeral information (e.g. "user said hi").

## Scheduling
- Use \`schedule_reminder\` when the user asks for timed reminders or recurring tasks. Convert natural language time to cron expressions (UTC timezone).
- Use \`list_scheduled_jobs\` and \`cancel_scheduled_job\` to manage existing reminders.
- Always confirm the scheduled time with the user after creating a reminder.

## Tool Usage
- Call \`get_current_time\` when you need to know the current date/time for scheduling or time-sensitive questions.
- You may call multiple tools in sequence to fulfill complex requests.
- If a tool call fails, explain the error to the user and suggest alternatives.

## Personality
- Your name is Jelly. You are warm but efficient, like a capable personal secretary who genuinely cares.
- Use humor sparingly and appropriately.
- Proactively offer help when you notice patterns (e.g. "You seem to ask about X often — want me to set a reminder?").`;

type AgentExt = Agent & {
  has_bot_token?: boolean;
  platforms?: Record<string, boolean>;
  owner_name?: string | null;
  owner_platform?: string | null;
};

export default function AgentsPage() {
  const t = useT();
  const origin = useOrigin();
  const [agents, setAgents] = useState<AgentExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [form, setForm] = useState({
    name: "",
    system_prompt: "",
    provider_id: "",
    model: "",
    access_mode: "open" as "open" | "approval" | "subscription",
    subscription_trial_count: 3,
    subscription_fallback: "require_approval" as "require_approval" | "require_payment",
    bot_locale: "en" as "en" | "zh",
    ai_soul: "",
    telegram_bot_token: "",
    tools_config: {} as Record<string, boolean>,
    platform_credentials: {} as Record<string, Record<string, string>>,
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [allProviders, setAllProviders] = useState<Provider[]>([]);
  const [allModels, setAllModels] = useState<ModelDef[]>([]);

  const [boundMcpNames, setBoundMcpNames] = useState<string[]>([]);
  const [boundSkillNames, setBoundSkillNames] = useState<string[]>([]);
  const [boundSubAppNames, setBoundSubAppNames] = useState<string[]>([]);
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [boundKbIds, setBoundKbIds] = useState<Set<string>>(new Set());
  const [boundKbNames, setBoundKbNames] = useState<string[]>([]);

  // Sub-dialogs
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [channelExpanded, setChannelExpanded] = useState<PlatformKey | null>(null);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load agents");
      setAgents(data.agents ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const [provRes, modRes] = await Promise.all([
        fetch("/api/admin/providers"),
        fetch("/api/admin/models"),
      ]);
      const provData = await provRes.json();
      const modData = await modRes.json();
      setAllProviders(provData.providers ?? []);
      setAllModels((modData.models ?? []).map((m: ModelDef & Record<string, unknown>) => ({
        id: m.id,
        model_id: m.model_id,
        label: m.label,
        provider_id: m.provider_id,
        provider_name: m.provider_name,
        provider_type: m.provider_type,
      })));
    } catch {
      // fallback empty
    }
  }, []);

  const fetchBoundResources = useCallback(async (agentId: string) => {
    setBoundMcpNames([]);
    setBoundSkillNames([]);
    setBoundSubAppNames([]);
    setBoundKbIds(new Set());
    setBoundKbNames([]);
    const [mcpRes, skillRes, kbRes, mcpListRes, skillListRes, kbListRes, subAppRes, subAppListRes] = await Promise.all([
      fetch(`/api/admin/agents/mcps?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/agents/skills?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/agents/knowledge?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/mcp").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/skills").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/knowledge/bases").then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/sub-apps?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/sub-apps").then((r) => r.json()).catch(() => ({})),
    ]);
    const mcpIds = new Set<string>(mcpRes.mcp_server_ids ?? []);
    const skillIds = new Set<string>(skillRes.skill_ids ?? []);
    const kbIdSet = new Set<string>(kbRes.knowledge_base_ids ?? []);
    const subAppIds = new Set<string>(subAppRes.sub_app_ids ?? []);
    const allMcps: McpServer[] = mcpListRes.servers ?? [];
    const allSkills: Skill[] = skillListRes.skills ?? [];
    const allKbs: KnowledgeBase[] = kbListRes.bases ?? [];
    const allSubApps: { id: string; name: string }[] = subAppListRes.sub_apps ?? [];
    setBoundMcpNames(allMcps.filter((m) => mcpIds.has(m.id)).map((m) => m.name));
    setBoundSkillNames(allSkills.filter((s) => skillIds.has(s.id)).map((s) => s.name));
    setBoundSubAppNames(allSubApps.filter((a) => subAppIds.has(a.id)).map((a) => a.name));
    setAllKnowledgeBases(allKbs);
    setBoundKbIds(kbIdSet);
    setBoundKbNames(allKbs.filter((kb) => kbIdSet.has(kb.id)).map((kb) => kb.name));
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchModels();
  }, [fetchAgents, fetchModels]);

  const filteredModels = form.provider_id
    ? allModels.filter((m) => m.provider_id === form.provider_id)
    : [];

  const selectedProviderName =
    allProviders.find((p) => p.id === form.provider_id)?.name ?? "";
  const selectedModelLabel =
    allModels.find((m) => m.model_id === form.model && m.provider_id === form.provider_id)?.label
    ?? allModels.find((m) => m.model_id === form.model)?.label
    ?? form.model;

  const enabledToolCount = PRIVILEGED_TOOLS.filter((t) => form.tools_config[t.key]).length;
  const configuredPlatformCount = (() => {
    let count = 0;
    if (form.telegram_bot_token || (editingAgent as AgentExt)?.has_bot_token) count++;
    const pc = form.platform_credentials;
    const p = (editingAgent as AgentExt)?.platforms || {};
    for (const plat of PLATFORMS) {
      if (plat.key === "telegram") continue;
      const hasNewCreds = plat.fields.every((f) => pc[plat.key]?.[f.name]?.trim());
      const hadSavedCreds = p[plat.key];
      if (hasNewCreds || hadSavedCreds) count++;
    }
    return count;
  })();

  function initEmptyForm() {
    const defaultToolsConfig: Record<string, boolean> = {};
    for (const tool of PRIVILEGED_TOOLS) {
      defaultToolsConfig[tool.key] = tool.defaultOn;
    }
    const firstProvider = allProviders[0];
    const firstModel = firstProvider
      ? allModels.find((m) => m.provider_id === firstProvider.id)
      : allModels[0];
    return {
      name: "",
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      provider_id: firstProvider?.id ?? "",
      model: firstModel?.model_id ?? "",
      access_mode: "open" as const,
      bot_locale: "en" as const,
      ai_soul: "",
      telegram_bot_token: "",
      tools_config: defaultToolsConfig,
      platform_credentials: {},
      subscription_trial_count: 3,
      subscription_fallback: "require_approval" as const,
    };
  }

  const openCreate = () => {
    setEditingAgent(null);
    setForm(initEmptyForm());
    setBoundMcpNames([]);
    setBoundSkillNames([]);
    setDialogOpen(true);
  };

  const openEdit = async (agent: Agent) => {
    setEditingAgent(agent);
    const tc = (agent.tools_config ?? {}) as Record<string, boolean>;
    let trialCount = 3;
    let fallback: "require_approval" | "require_payment" = "require_approval";
    if (agent.access_mode === "subscription") {
      try {
        const ruleRes = await fetch(`/api/admin/subscriptions?view=rules&agent_id=${agent.id}`);
        const ruleData = await ruleRes.json();
        const rule = (ruleData.rules ?? [])[0];
        if (rule) {
          trialCount = rule.trial_count ?? 3;
          fallback = rule.fallback_action || "require_approval";
        }
      } catch { /* fallback defaults */ }
    }
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      provider_id: agent.provider_id || "",
      model: agent.model,
      access_mode: agent.access_mode || "open",
      bot_locale: (agent as Agent & { bot_locale?: string }).bot_locale === "zh" ? "zh" : "en",
      ai_soul: agent.ai_soul || "",
      telegram_bot_token: "",
      tools_config: tc,
      platform_credentials: {},
      subscription_trial_count: trialCount,
      subscription_fallback: fallback,
    });
    fetchBoundResources(agent.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(t("agents.agentNameRequired"));
      return;
    }
    setSaving(true);
    try {
      const method = editingAgent ? "PUT" : "POST";
      const { provider_id, platform_credentials, subscription_trial_count, subscription_fallback, ...restForm } = form;
      const hasCreds = Object.values(platform_credentials).some(
        (fields) => Object.values(fields).some((v) => v.trim()),
      );
      const formData = {
        ...restForm,
        provider_id: provider_id || null,
        ...(hasCreds ? { platform_credentials } : {}),
      };
      const payload = editingAgent ? { id: editingAgent.id, ...formData } : formData;
      const res = await fetch("/api/admin/agents", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const savedAgentId = editingAgent?.id || data.agent?.id;

      if (savedAgentId && form.access_mode === "subscription") {
        try {
          await fetch("/api/admin/subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upsert_rule",
              agent_id: savedAgentId,
              trial_count: subscription_trial_count,
              fallback_action: subscription_fallback,
            }),
          });
        } catch { /* non-blocking */ }
      }

      const baseUrl = origin || window.location.origin;
      if (savedAgentId && form.telegram_bot_token && baseUrl) {
        try {
          await fetch("/api/admin/platform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: "telegram",
              action: "set-webhook",
              agent_id: savedAgentId,
              webhook_url: `${baseUrl}/api/webhook/telegram`,
            }),
          });
        } catch {
          // non-blocking
        }
      }

      toast.success(editingAgent ? t("agents.agentUpdated") : t("agents.agentCreated"));
      setDialogOpen(false);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.saving"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteAgent = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/agents?id=${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("agents.agentDeleted"));
      setDeleteTarget(null);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    }
  };

  const handleTestConnection = async (platform: PlatformKey) => {
    if (!editingAgent) return;
    setTestingPlatform(platform);
    try {
      const payload: Record<string, unknown> = {
        platform,
        action: "test-connection",
        agent_id: editingAgent.id,
      };
      if (platform === "telegram" && form.telegram_bot_token) {
        payload.inline_token = form.telegram_bot_token;
      } else if (platform !== "telegram") {
        const creds = form.platform_credentials[platform];
        if (creds && Object.values(creds).some((v) => v?.trim())) {
          payload.inline_credentials = creds;
        }
      }
      const res = await fetch("/api/admin/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || t("agents.testSuccess"));
      } else {
        toast.error(data.error || data.message || t("agents.testFailed"));
      }
    } catch {
      toast.error(t("agents.testFailed"));
    } finally {
      setTestingPlatform(null);
    }
  };

  const handleSetWebhook = async (agentId: string) => {
    const baseUrl = origin || window.location.origin;
    if (!baseUrl) { toast.error("Cannot determine app URL"); return; }
    try {
      const res = await fetch("/api/admin/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "telegram",
          action: "set-webhook",
          agent_id: agentId,
          webhook_url: `${baseUrl}/api/webhook/telegram`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("agents.webhookSet"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.webhookSetFailed"));
    }
  };

  const copyWebhookUrl = (platform: PlatformKey, agentId: string) => {
    const url = `${origin}/api/webhook/${platform}/${agentId}`;
    navigator.clipboard.writeText(url);
    toast.success(t("agents.copyWebhookUrl"));
  };

  // ── Channels sub-dialog content ──
  function renderChannelsDialog() {
    if (channelExpanded) {
      const plat = PLATFORMS.find((p) => p.key === channelExpanded)!;
      const isConnected = channelExpanded === "telegram"
        ? !!form.telegram_bot_token || !!(editingAgent as AgentExt)?.has_bot_token
        : !!(editingAgent as AgentExt)?.platforms?.[channelExpanded];
      const hasNewInput = channelExpanded === "telegram"
        ? !!form.telegram_bot_token
        : Object.values(form.platform_credentials[channelExpanded] || {}).some((v) => v?.trim());

      return (
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" onClick={() => setChannelExpanded(null)}>
                <ArrowLeft className="size-4" />
              </Button>
              {plat.label}
            </DialogTitle>
            <DialogDescription>
              {t("agents.channelsDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {channelExpanded === "telegram" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Bot Token</Label>
                  <Input
                    type="password"
                    value={form.telegram_bot_token}
                    onChange={(e) => setForm((f) => ({ ...f, telegram_bot_token: e.target.value }))}
                    placeholder={
                      (editingAgent as AgentExt)?.has_bot_token
                        ? t("agents.credentialKeepHint")
                        : "Paste token from @BotFather"
                    }
                  />
                </div>
                {editingAgent && (
                  <div className="flex flex-col gap-3 rounded-md border p-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">{t("agents.webhookUrlLabel")}</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          readOnly
                          value={`${origin}/api/webhook/telegram/${editingAgent.id}`}
                          className="h-8 text-xs font-mono"
                          onFocus={(e) => e.target.select()}
                        />
                        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => copyWebhookUrl("telegram", editingAgent.id)}>
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetWebhook(editingAgent.id)}
                        disabled={!isConnected}
                      >
                        <Zap className="mr-1.5 size-3.5" />
                        {t("agents.setWebhook")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection("telegram")}
                        disabled={testingPlatform === "telegram" || !isConnected}
                      >
                        {testingPlatform === "telegram"
                          ? <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          : <CheckCircle2 className="mr-1.5 size-3.5" />}
                        {testingPlatform === "telegram" ? t("agents.testing") : t("agents.testConnection")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {PLATFORM_HINT_KEYS[channelExpanded as PlatformKey] && (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
                    {t(`agents.${PLATFORM_HINT_KEYS[channelExpanded as PlatformKey]}` as never)}
                  </p>
                )}
                {channelExpanded === "wecom" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                    {t("agents.wecomGatewayHint")}
                  </p>
                )}
                {plat.fields.map((field) => (
                  <div key={field.name} className="flex flex-col gap-1.5">
                    <Label>{field.label}</Label>
                    <Input
                      type={field.secret ? "password" : "text"}
                      value={form.platform_credentials[channelExpanded]?.[field.name] || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          platform_credentials: {
                            ...f.platform_credentials,
                            [channelExpanded]: {
                              ...f.platform_credentials[channelExpanded],
                              [field.name]: e.target.value,
                            },
                          },
                        }))
                      }
                      placeholder={
                        isConnected ? t("agents.credentialKeepHint") : field.label
                      }
                    />
                  </div>
                ))}
                {editingAgent && (
                  <div className="flex flex-col gap-3 rounded-md border p-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">{t("agents.webhookUrlLabel")}</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          readOnly
                          value={`${origin}/api/webhook/${channelExpanded}/${editingAgent.id}`}
                          className="h-8 text-xs font-mono"
                          onFocus={(e) => e.target.select()}
                        />
                        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => copyWebhookUrl(channelExpanded, editingAgent.id)}>
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {(isConnected || hasNewInput) && (
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => handleTestConnection(channelExpanded)}
                          disabled={testingPlatform === channelExpanded}
                        >
                          {testingPlatform === channelExpanded
                            ? <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            : <CheckCircle2 className="mr-1.5 size-3.5" />}
                          {testingPlatform === channelExpanded ? t("agents.testing") : t("agents.testConnection")}
                        </Button>
                        {channelExpanded === "qqbot" && (
                          <p className="text-xs text-muted-foreground">{t("agents.qqbotWebhookHint")}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChannelExpanded(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => setChannelExpanded(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      );
    }

    return (
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("agents.channelsTitle")}</DialogTitle>
          <DialogDescription>{t("agents.channelsDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          {PLATFORMS.map((plat) => {
            const isConnected = plat.key === "telegram"
              ? !!form.telegram_bot_token || !!(editingAgent as AgentExt)?.has_bot_token
              : !!(editingAgent as AgentExt)?.platforms?.[plat.key];
            const hasNewInput = plat.key === "telegram"
              ? !!form.telegram_bot_token
              : Object.values(form.platform_credentials[plat.key] || {}).some((v) => v.trim());

            return (
              <button
                key={plat.key}
                onClick={() => setChannelExpanded(plat.key)}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <plat.icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{plat.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {isConnected || hasNewInput
                      ? t("agents.platformConnected")
                      : t("agents.platformClickToConfigure")}
                  </p>
                </div>
                <div className="shrink-0">
                  {isConnected || hasNewInput ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />
                      {hasNewInput ? "New" : t("agents.platformConnected")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <XCircle className="size-3" />
                      {t("agents.platformNotConnected")}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button onClick={() => setChannelsOpen(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  // ── Tools sub-dialog content ──
  function renderToolsDialog() {
    return (
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 bg-background pb-3 border-b">
          <DialogTitle>{t("agents.toolsTitle")}</DialogTitle>
          <DialogDescription>{t("agents.toolsDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2 overflow-y-auto flex-1 min-h-0">
          {PRIVILEGED_TOOLS.map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-start gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/50 transition-colors"
            >
              <Switch
                className="mt-0.5 shrink-0"
                checked={!!form.tools_config[key]}
                onCheckedChange={(checked) =>
                  setForm((f) => ({
                    ...f,
                    tools_config: { ...f.tools_config, [key]: checked },
                  }))
                }
              />
              <div className="min-w-0">
                <code className="text-xs font-medium">{label}</code>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {t(desc)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button onClick={() => setToolsOpen(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  function renderPlatformStatus(agent: AgentExt) {
    const platforms = agent.platforms || {};
    const connected = PLATFORMS.filter((p) => platforms[p.key]);
    if (connected.length === 0) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {connected.map((plat) => (
          <div key={plat.key} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 hover:bg-muted transition-colors px-2.5 py-1 text-muted-foreground">
            <plat.icon className="size-3.5 opacity-70" />
            <span className="text-[11px] font-medium leading-none">{plat.label}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("agents.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("agents.subtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger id="agents-create-dialog-trigger" render={<Button onClick={openCreate} />}>
            <Plus className="mr-1.5 size-4" />
            {t("agents.newAgent")}
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] sm:max-w-3xl flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0 bg-background pb-3 border-b">
              <DialogTitle>
                {editingAgent ? t("agents.editAgent") : t("agents.createAgent")}
              </DialogTitle>
              <DialogDescription>
                {editingAgent ? t("agents.editDesc") : t("agents.createDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 py-1">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("agents.name")}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t("agents.namePlaceholder")}
                />
              </div>

              {/* Provider & Model */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.provider")}</Label>
                  <Select
                    value={form.provider_id}
                    onValueChange={(v) => {
                      const pid = v ?? "";
                      const provModels = allModels.filter((m) => m.provider_id === pid);
                      setForm((f) => ({ ...f, provider_id: pid, model: provModels[0]?.model_id ?? "" }));
                    }}
                  >
                    <SelectTrigger>
                      {selectedProviderName ? (
                        <span>{selectedProviderName}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("agents.selectProvider")}</span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {allProviders.filter((p) => p.enabled).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.model")}</Label>
                  <Select
                    value={form.model}
                    onValueChange={(v) => setForm((f) => ({ ...f, model: v ?? f.model }))}
                    disabled={!form.provider_id}
                  >
                    <SelectTrigger>
                      {form.model ? (
                        <span>{selectedModelLabel}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {form.provider_id ? t("agents.selectModel") : t("agents.selectProviderFirst")}
                        </span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {filteredModels.map((m) => (
                        <SelectItem key={m.model_id} value={m.model_id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Access mode + Bot locale */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.accessMode")}</Label>
                  <Select
                    value={form.access_mode}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, access_mode: (v ?? f.access_mode) as "open" | "approval" | "subscription" }))
                    }
                  >
                    <SelectTrigger>
                      {form.access_mode === "subscription" ? t("agents.subscription") : form.access_mode === "approval" ? t("agents.approval") : t("agents.open")}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">
                        <div>
                          <div>{t("agents.open")}</div>
                          <div className="text-xs text-muted-foreground">{t("agents.accessModeOpenDesc")}</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="approval">
                        <div>
                          <div>{t("agents.approval")}</div>
                          <div className="text-xs text-muted-foreground">{t("agents.accessModeApprovalDesc")}</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="subscription">
                        <div>
                          <div>{t("agents.subscription")}</div>
                          <div className="text-xs text-muted-foreground">{t("agents.accessModeSubscriptionDesc")}</div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.botLocale")}</Label>
                  <Select
                    value={form.bot_locale}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, bot_locale: (v ?? f.bot_locale) as "en" | "zh" }))
                    }
                  >
                    <SelectTrigger>
                      {form.bot_locale === "zh" ? t("agents.botLocaleZh") : t("agents.botLocaleEn")}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("agents.botLocaleEn")}</SelectItem>
                      <SelectItem value="zh">{t("agents.botLocaleZh")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("agents.botLocaleHint")}</p>
                </div>
              </div>

              {/* Subscription inline config */}
              {form.access_mode === "subscription" && (
                <div className="flex flex-col gap-3 rounded-md border p-3 bg-muted/30">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("agents.subscriptionTrialCount")}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.subscription_trial_count}
                        onChange={(e) => setForm((f) => ({ ...f, subscription_trial_count: parseInt(e.target.value) || 0 }))}
                      />
                      <p className="text-xs text-muted-foreground">{t("agents.subscriptionTrialCountHint")}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("agents.subscriptionFallback")}</Label>
                      <Select
                        value={form.subscription_fallback}
                        onValueChange={(v) => setForm((f) => ({ ...f, subscription_fallback: (v ?? f.subscription_fallback) as "require_approval" | "require_payment" }))}
                      >
                        <SelectTrigger>
                          {form.subscription_fallback === "require_payment" ? t("agents.subscriptionFallbackPayment") : t("agents.subscriptionFallbackApproval")}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="require_approval">{t("agents.subscriptionFallbackApproval")}</SelectItem>
                          <SelectItem value="require_payment">{t("agents.subscriptionFallbackPayment")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{t("agents.subscriptionConfigHint")}</p>
                    <a href="/dashboard/subscriptions" className="text-xs text-primary hover:underline shrink-0">{t("agents.subscriptionGoToPlans")}</a>
                  </div>
                </div>
              )}

              {/* System prompt */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("agents.systemPrompt")}</Label>
                <Textarea
                  rows={4}
                  className="max-h-32 resize-y"
                  value={form.system_prompt}
                  onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                  placeholder={t("agents.systemPromptPlaceholder")}
                />
              </div>

              {/* AI Soul */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("agents.aiSoul")}</Label>
                <Textarea
                  rows={2}
                  className="max-h-20 resize-y"
                  value={form.ai_soul}
                  onChange={(e) => setForm((f) => ({ ...f, ai_soul: e.target.value }))}
                  placeholder={t("agents.aiSoulPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("agents.aiSoulHint")}</p>
              </div>

              {/* ── Channels & Tools: entry buttons ── */}
              <div className="grid grid-cols-2 gap-3">
                <Dialog open={channelsOpen} onOpenChange={(open) => { setChannelsOpen(open); if (!open) setChannelExpanded(null); }}>
                  <DialogTrigger
                    render={
                      <button
                        onClick={() => setChannelsOpen(true)}
                        className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/50"
                      />
                    }
                  >
                    <Settings2 className="size-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{t("agents.configureChannels")}</p>
                      <p className="text-xs text-muted-foreground">
                        {configuredPlatformCount > 0
                          ? `${configuredPlatformCount} ${t("agents.platformConnected").toLowerCase()}`
                          : t("agents.noPlatformsConnected")}
                      </p>
                    </div>
                    <Badge variant={configuredPlatformCount > 0 ? "secondary" : "outline"} className="text-xs">
                      {configuredPlatformCount}
                    </Badge>
                  </DialogTrigger>
                  {renderChannelsDialog()}
                </Dialog>

                <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
                  <DialogTrigger
                    render={
                      <button
                        onClick={() => setToolsOpen(true)}
                        className="flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/50"
                      />
                    }
                  >
                    <Settings2 className="size-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{t("agents.configureTools")}</p>
                      <p className="text-xs text-muted-foreground">
                        {enabledToolCount}/{PRIVILEGED_TOOLS.length}
                      </p>
                    </div>
                    <Badge variant={enabledToolCount > 0 ? "secondary" : "outline"} className="text-xs">
                      {enabledToolCount}
                    </Badge>
                  </DialogTrigger>
                  {renderToolsDialog()}
                </Dialog>
              </div>

              {/* Bindings (edit only) */}
              {editingAgent && (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  {boundMcpNames.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t("agents.mcpServers")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {boundMcpNames.map((name) => (
                          <Badge key={name} variant="secondary">{name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {boundSkillNames.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t("agents.skills")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {boundSkillNames.map((name) => (
                          <Badge key={name} variant="secondary">{name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {boundSubAppNames.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t("sidebar.subApps")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {boundSubAppNames.map((name) => (
                          <Badge key={name} variant="secondary">{name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Knowledge base multi-select */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("agents.knowledgeBases")}</p>
                    {allKnowledgeBases.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("agents.noKnowledgeBases")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {allKnowledgeBases.filter((kb) => !kb.parent_id).map((kb) => (
                          <Badge
                            key={kb.id}
                            variant={boundKbIds.has(kb.id) ? "default" : "outline"}
                            className="cursor-pointer select-none"
                            onClick={async () => {
                              const next = new Set(boundKbIds);
                              if (next.has(kb.id)) next.delete(kb.id); else next.add(kb.id);
                              setBoundKbIds(next);
                              setBoundKbNames(allKnowledgeBases.filter((k) => next.has(k.id)).map((k) => k.name));
                              await fetch("/api/admin/agents/knowledge", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ agent_id: editingAgent.id, knowledge_base_ids: [...next] }),
                              });
                            }}
                          >
                            {kb.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{t("agents.kbBindHint")}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("agents.bindFromResourcePage")}</p>
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t pt-3">
              <Button variant="ghost" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Agents list ── */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-1 h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Bot className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">{t("agents.noAgents")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("agents.noAgentsHint")}</p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 size-4" />
              {t("agents.createAgent")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((agent) => (
            <Card key={agent.id} className="transition-all hover:shadow-md hover:-translate-y-0.5 border-border/50 hover:border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <span className="truncate">{agent.name}</span>
                      {agent.is_default && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0 bg-muted/60 hover:bg-muted font-medium">{t("agents.default")}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md border border-border/30 truncate max-w-[120px] sm:max-w-[200px]" title={agent.model}>{agent.model}</span>
                      <span className="text-muted-foreground/30">•</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        {agent.access_mode === "subscription" ? <Lock className="size-3" /> : <Globe className="size-3" />}
                        {agent.access_mode === "subscription"
                          ? t("agents.subscription")
                          : agent.access_mode === "approval"
                            ? t("agents.approval")
                            : t("agents.open")}
                      </span>
                      <span className="text-muted-foreground/30">•</span>
                      <span className="flex items-center gap-1 text-muted-foreground" title={(agent as AgentExt).owner_name || t("agents.noOwner")}>
                        <User className="size-3" />
                        <span className="truncate max-w-[80px] sm:max-w-[120px]">
                          {(agent as AgentExt).owner_name || t("agents.noOwner")}
                        </span>
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex gap-1 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(agent)} className="h-7 w-7">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(agent)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-0">
                <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground border border-border/40 relative">
                  <div className="absolute top-2 left-2 text-muted-foreground/20 font-serif text-2xl leading-none">"</div>
                  <p className="line-clamp-2 relative z-10 pl-4 italic text-xs/relaxed">
                    {agent.system_prompt || t("agents.noSystemPrompt")}
                  </p>
                </div>
                {renderPlatformStatus(agent)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("agents.deleteAgent")}
        description={t("agents.deleteAgentConfirm", { name: deleteTarget?.name || "" })}
        confirmText={t("common.delete")}
        onConfirm={confirmDeleteAgent}
      />
    </div>
  );
}
