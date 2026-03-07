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
import { Plus, Pencil, Trash2, Lock, Globe, Bot } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import type { Agent, McpServer, Skill } from "@/types/database";
import { getAvailableModels, MODEL_CATALOG, type ModelDef } from "@/lib/models";

export default function AgentsPage() {
  const t = useT();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    name: "",
    system_prompt: "",
    model: "",
    access_mode: "open" as "open" | "whitelist",
    ai_soul: "",
    telegram_bot_token: "",
    mcp_server_ids: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [availableModels, setAvailableModels] =
    useState<ModelDef[]>(MODEL_CATALOG);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [boundSkillIds, setBoundSkillIds] = useState<string[]>([]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load agents");
      }
      setAgents(data.agents ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load agents");
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

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mcp");
      const data = await res.json();
      if (res.ok) setMcpServers((data.servers ?? []).filter((s: McpServer) => s.enabled));
    } catch {
      // non-critical
    }
  }, []);

  const fetchAllSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/skills");
      const data = await res.json();
      if (res.ok) setAllSkills(data.skills ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const fetchBoundSkills = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`/api/admin/agents/skills?agent_id=${agentId}`);
      const data = await res.json();
      if (res.ok) setBoundSkillIds(data.skill_ids ?? []);
    } catch {
      setBoundSkillIds([]);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchModels();
    fetchMcpServers();
    fetchAllSkills();
  }, [fetchAgents, fetchModels, fetchMcpServers, fetchAllSkills]);

  const openCreate = () => {
    setEditingAgent(null);
    setForm({
      name: "",
      system_prompt: "",
      model: availableModels[0]?.id ?? "",
      access_mode: "open",
      ai_soul: "",
      telegram_bot_token: "",
      mcp_server_ids: [],
    });
    setBoundSkillIds([]);
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      model: agent.model,
      access_mode: agent.access_mode || "open",
      ai_soul: agent.ai_soul || "",
      telegram_bot_token: "",
      mcp_server_ids: agent.mcp_server_ids ?? [],
    });
    fetchBoundSkills(agent.id);
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

      const agentId = editingAgent?.id || data.agent?.id;
      if (agentId && allSkills.length > 0) {
        await fetch("/api/admin/agents/skills", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: agentId, skill_ids: boundSkillIds }),
        });
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
          <h1 className="text-2xl font-semibold tracking-tight">{t("agents.title")}</h1>
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
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingAgent ? t("agents.editAgent") : t("agents.createAgent")}
              </DialogTitle>
              <DialogDescription>
                {editingAgent ? t("agents.editDesc") : t("agents.createDesc")}
              </DialogDescription>
            </DialogHeader>
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
              <div className="grid grid-cols-2 gap-4">
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
                          | "whitelist",
                      }))
                    }
                  >
                    <SelectTrigger id="agents-access-mode-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{t("agents.open")}</SelectItem>
                      <SelectItem value="whitelist">{t("agents.whitelist")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("agents.systemPrompt")}</Label>
                <Textarea
                  rows={6}
                  className="max-h-48 resize-y"
                  value={form.system_prompt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, system_prompt: e.target.value }))
                  }
                  placeholder={t("agents.systemPromptPlaceholder")}
                />
              </div>
              {mcpServers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.mcpServers")}</Label>
                  <div className="flex flex-wrap gap-2 rounded-md border p-2">
                    {mcpServers.map((s) => {
                      const selected = form.mcp_server_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              mcp_server_ids: selected
                                ? f.mcp_server_ids.filter((id) => id !== s.id)
                                : [...f.mcp_server_ids, s.id],
                            }))
                          }
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("agents.mcpToggleHint")}
                  </p>
                </div>
              )}
              {allSkills.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("agents.skills")}</Label>
                  <div className="flex flex-wrap gap-2 rounded-md border p-2">
                    {allSkills.map((s) => {
                      const selected = boundSkillIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setBoundSkillIds((prev) =>
                              selected
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id]
                            )
                          }
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("agents.skillsToggleHint")}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label>{t("agents.aiSoul")}</Label>
                <Textarea
                  rows={3}
                  className="max-h-32 resize-y"
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
            <DialogFooter>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
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
                      <span className="font-mono text-xs">{agent.model}</span>
                      <Badge
                        variant={
                          agent.access_mode === "whitelist"
                            ? "destructive"
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
              <CardContent>
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {agent.system_prompt || t("agents.noSystemPrompt")}
                </p>
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
        onConfirm={confirmDeleteAgent}
      />
    </div>
  );
}
