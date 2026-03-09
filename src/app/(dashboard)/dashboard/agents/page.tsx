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
  SelectValue,
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
  Webhook,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import type { Agent, McpServer, Skill } from "@/types/database";
import {
  getAvailableModels,
  MODEL_CATALOG,
  type ModelDef,
} from "@/lib/models";

export default function AgentsPage() {
  const t = useT();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const PRIVILEGED_TOOLS = [
    { key: "run_sql", label: "run_sql", desc: "agents.toolRunSql", defaultOn: false },
    { key: "schedule_task", label: "schedule_task", desc: "agents.toolScheduleTask", defaultOn: true },
    { key: "cancel_scheduled_job", label: "cancel_scheduled_job", desc: "agents.toolCancelJob", defaultOn: true },
    { key: "list_scheduled_jobs", label: "list_scheduled_jobs", desc: "agents.toolListJobs", defaultOn: true },
    { key: "run_python_code", label: "run_python_code", desc: "coding.toolRunPython", defaultOn: false },
    { key: "run_javascript_code", label: "run_javascript_code", desc: "coding.toolRunJS", defaultOn: false },
    { key: "run_html_preview", label: "run_html_preview", desc: "coding.toolRunHTML", defaultOn: false },
    { key: "install_packages", label: "install_packages", desc: "coding.toolInstallPkg", defaultOn: false },
    { key: "sandbox_file_ops", label: "sandbox_file_ops", desc: "coding.toolFileOps", defaultOn: false },
  ] as const;

  const [form, setForm] = useState({
    name: "",
    system_prompt: "",
    model: "",
    access_mode: "open" as "open" | "approval" | "whitelist",
    ai_soul: "",
    telegram_bot_token: "",
    tools_config: {} as Record<string, boolean>,
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [availableModels, setAvailableModels] =
    useState<ModelDef[]>(MODEL_CATALOG);

  const [boundMcpNames, setBoundMcpNames] = useState<string[]>([]);
  const [boundSkillNames, setBoundSkillNames] = useState<string[]>([]);

  const [webhookStatus, setWebhookStatus] = useState<
    Record<string, { url: string; pending: number } | null>
  >({});
  const [settingWebhook, setSettingWebhook] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load agents");
      }
      setAgents(data.agents ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load agents"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/secrets");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load secrets");
      }
      const keyNames = new Set(
        (data.secrets ?? []).map((s: { key_name: string }) => s.key_name)
      );
      const models = getAvailableModels(keyNames as Set<string>);
      setAvailableModels(models.length > 0 ? models : MODEL_CATALOG);
    } catch {
      // fallback to full catalog
    }
  }, []);

  const fetchBoundResources = useCallback(async (agentId: string) => {
    setBoundMcpNames([]);
    setBoundSkillNames([]);

    const [mcpRes, skillRes, mcpListRes, skillListRes] = await Promise.all([
      fetch(`/api/admin/agents/mcps?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/agents/skills?agent_id=${agentId}`).then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/mcp").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/skills").then((r) => r.json()).catch(() => ({})),
    ]);

    const mcpIds = new Set<string>(mcpRes.mcp_server_ids ?? []);
    const skillIds = new Set<string>(skillRes.skill_ids ?? []);
    const allMcps: McpServer[] = mcpListRes.servers ?? [];
    const allSkills: Skill[] = skillListRes.skills ?? [];

    setBoundMcpNames(allMcps.filter((m) => mcpIds.has(m.id)).map((m) => m.name));
    setBoundSkillNames(allSkills.filter((s) => skillIds.has(s.id)).map((s) => s.name));
  }, []);

  const fetchWebhookInfo = useCallback(async (agentId: string) => {
    try {
      const res = await fetch("/api/admin/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-info", agent_id: agentId }),
      });
      const data = await res.json();
      if (res.ok && data.webhook) {
        setWebhookStatus((prev) => ({
          ...prev,
          [agentId]: {
            url: data.webhook.url || "",
            pending: data.webhook.pending_update_count ?? 0,
          },
        }));
      } else {
        setWebhookStatus((prev) => ({ ...prev, [agentId]: null }));
      }
    } catch {
      setWebhookStatus((prev) => ({ ...prev, [agentId]: null }));
    }
  }, []);

  const handleSetWebhook = async (agentId: string) => {
    setSettingWebhook(agentId);
    try {
      const res = await fetch("/api/admin/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-webhook",
          agent_id: agentId,
          webhook_url: `${window.location.origin}/api/webhook/telegram`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("agents.webhookSet"));
      fetchWebhookInfo(agentId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("agents.webhookSetFailed")
      );
    } finally {
      setSettingWebhook(null);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchModels();
  }, [fetchAgents, fetchModels]);

  useEffect(() => {
    const agentsWithBot = agents.filter(
      (a) => (a as Agent & { has_bot_token?: boolean }).has_bot_token
    );
    agentsWithBot.forEach((a) => fetchWebhookInfo(a.id));
  }, [agents, fetchWebhookInfo]);

  const openCreate = () => {
    setEditingAgent(null);
    const defaultToolsConfig: Record<string, boolean> = {};
    for (const t of PRIVILEGED_TOOLS) {
      defaultToolsConfig[t.key] = t.defaultOn;
    }
    setForm({
      name: "",
      system_prompt: "",
      model: availableModels[0]?.id ?? "",
      access_mode: "open",
      ai_soul: "",
      telegram_bot_token: "",
      tools_config: defaultToolsConfig,
    });
    setBoundMcpNames([]);
    setBoundSkillNames([]);
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    const tc = (agent.tools_config ?? {}) as Record<string, boolean>;
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      model: agent.model,
      access_mode: agent.access_mode || "open",
      ai_soul: agent.ai_soul || "",
      telegram_bot_token: "",
      tools_config: tc,
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
      const payload = editingAgent ? { id: editingAgent.id, ...form } : form;
      const res = await fetch("/api/admin/agents", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const savedAgentId = editingAgent?.id || data.agent?.id;
      if (savedAgentId && form.telegram_bot_token) {
        try {
          await fetch("/api/admin/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "set-webhook",
              agent_id: savedAgentId,
              webhook_url: `${window.location.origin}/api/webhook/telegram`,
            }),
          });
        } catch {
          // non-blocking
        }
      }

      toast.success(
        editingAgent ? t("agents.agentUpdated") : t("agents.agentCreated")
      );
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
      const res = await fetch(`/api/admin/agents?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("agents.agentDeleted"));
      setDeleteTarget(null);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("agents.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agents.subtitle")}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            id="agents-create-dialog-trigger"
            render={<Button onClick={openCreate} />}
          >
            <Plus className="mr-1.5 size-4" />
            {t("agents.newAgent")}
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] sm:max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingAgent
                  ? t("agents.editAgent")
                  : t("agents.createAgent")}
              </DialogTitle>
              <DialogDescription>
                {editingAgent ? t("agents.editDesc") : t("agents.createDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr]">
              {/* ── Left column: Basic settings ── */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.name")}</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder={t("agents.namePlaceholder")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.botToken")}</Label>
                  <Input
                    type="password"
                    value={form.telegram_bot_token}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telegram_bot_token: e.target.value,
                      }))
                    }
                    placeholder={
                      editingAgent?.telegram_bot_token
                        ? t("agents.botTokenKeep")
                        : t("agents.botTokenNew")
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("agents.botTokenHint")}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.model")}</Label>
                  <Select
                    value={form.model}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, model: v ?? f.model }))
                    }
                  >
                    <SelectTrigger id="agents-model-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {m.provider}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.accessMode")}</Label>
                  <Select
                    value={form.access_mode}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        access_mode: (v ?? f.access_mode) as
                          | "open"
                          | "approval"
                          | "whitelist",
                      }))
                    }
                  >
                    <SelectTrigger id="agents-access-mode-select-trigger">
                      <SelectValue />
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
                      <SelectItem value="whitelist">
                        <div>
                          <div>{t("agents.whitelist")}</div>
                          <div className="text-xs text-muted-foreground">{t("agents.accessModeWhitelistDesc")}</div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.systemPrompt")}</Label>
                  <Textarea
                    rows={5}
                    className="max-h-40 resize-y"
                    value={form.system_prompt}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        system_prompt: e.target.value,
                      }))
                    }
                    placeholder={t("agents.systemPromptPlaceholder")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.aiSoul")}</Label>
                  <Textarea
                    rows={3}
                    className="max-h-28 resize-y"
                    value={form.ai_soul}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ai_soul: e.target.value }))
                    }
                    placeholder={t("agents.aiSoulPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("agents.aiSoulHint")}
                  </p>
                </div>
              </div>

              {/* ── Divider ── */}
              <div className="hidden md:block w-px bg-border" />

              {/* ── Right column: Tools & Bindings ── */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.privilegedTools")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("agents.privilegedToolsHint")}
                  </p>
                  <div className="flex flex-col gap-2">
                    {PRIVILEGED_TOOLS.map(({ key, label, desc }) => (
                      <label
                        key={key}
                        className="flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
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
                      </label>
                    ))}
                  </div>
                </div>

                {editingAgent && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("agents.mcpServers")}</Label>
                      {boundMcpNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {boundMcpNames.map((name) => (
                            <Badge key={name} variant="secondary">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t("agents.noBindings")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t("agents.bindFromResourcePage")}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("agents.skills")}</Label>
                      {boundSkillNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {boundSkillNames.map((name) => (
                            <Badge key={name} variant="secondary">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t("agents.noBindings")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t("agents.bindFromResourcePage")}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                className="w-full sm:w-auto"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
              <p className="mt-1 text-sm text-muted-foreground">
                {t("agents.noAgentsHint")}
              </p>
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
            <Card
              key={agent.id}
              className="transition-shadow hover:shadow-md"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {agent.name}
                      {agent.is_default && (
                        <Badge variant="secondary" className="text-xs">
                          {t("agents.default")}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs">
                        {agent.model}
                      </span>
                      <Badge
                        variant={
                          agent.access_mode === "whitelist"
                            ? "destructive"
                            : agent.access_mode === "approval"
                              ? "secondary"
                              : "outline"
                        }
                        className="gap-1 text-xs"
                      >
                        {agent.access_mode === "whitelist" ? (
                          <Lock className="size-3" />
                        ) : (
                          <Globe className="size-3" />
                        )}
                        {agent.access_mode === "whitelist"
                          ? t("agents.whitelist")
                          : agent.access_mode === "approval"
                            ? t("agents.approval")
                            : t("agents.open")}
                      </Badge>
                      <Badge
                        variant={
                          (
                            agent as Agent & {
                              has_bot_token?: boolean;
                            }
                          ).has_bot_token
                            ? "secondary"
                            : "outline"
                        }
                        className="gap-1 text-xs"
                      >
                        <Bot className="size-3" />
                        {(
                          agent as Agent & {
                            has_bot_token?: boolean;
                          }
                        ).has_bot_token
                          ? t("agents.botActive")
                          : t("agents.noBot")}
                      </Badge>
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(agent)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(agent)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {agent.system_prompt || t("agents.noSystemPrompt")}
                </p>
                {(agent as Agent & { has_bot_token?: boolean })
                  .has_bot_token && (
                    <div className="flex items-center gap-2 rounded-md border p-2 overflow-hidden">
                      <Webhook className="size-4 shrink-0 text-muted-foreground" />
                      {(() => {
                        const info = webhookStatus[agent.id];
                        const isLoading = !(agent.id in webhookStatus);
                        const isSet = info && info.url;
                        const isSetting = settingWebhook === agent.id;

                        if (isLoading) {
                          return (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" />
                              {t("common.loading")}
                            </span>
                          );
                        }

                        if (isSet) {
                          return (
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                                  <CheckCircle2 className="size-3" />
                                  {t("agents.webhookActive")}
                                </span>
                                <p
                                  className="truncate text-[10px] text-muted-foreground"
                                  title={info.url}
                                >
                                  {info.url}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="xs"
                                className="shrink-0"
                                onClick={() => handleSetWebhook(agent.id)}
                                disabled={isSetting}
                              >
                                {isSetting ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  t("agents.setWebhook")
                                )}
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                              <XCircle className="size-3" />
                              {t("agents.webhookNotSet")}
                            </span>
                            <Button
                              variant="default"
                              size="xs"
                              className="shrink-0"
                              onClick={() => handleSetWebhook(agent.id)}
                              disabled={isSetting}
                            >
                              {isSetting ? (
                                <>
                                  <Loader2 className="mr-1 size-3 animate-spin" />
                                  {t("agents.settingWebhook")}
                                </>
                              ) : (
                                t("agents.setWebhook")
                              )}
                            </Button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("agents.deleteAgent")}
        description={t("agents.deleteAgentConfirm", {
          name: deleteTarget?.name || "",
        })}
        confirmText={t("common.delete")}
        onConfirm={confirmDeleteAgent}
      />
    </div>
  );
}
