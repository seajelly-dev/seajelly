"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RefreshCw, AppWindow, Bot, Wrench } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { SubApp, Agent } from "@/types/database";

export default function SubAppsPage() {
  const t = useT();
  const [subApps, setSubApps] = useState<SubApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<SubApp | null>(null);
  const [boundAgentIds, setBoundAgentIds] = useState<string[]>([]);
  const [bindSaving, setBindSaving] = useState(false);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("subApps.title")}</h1>
          <p className="text-muted-foreground">{t("subApps.subtitle")}</p>
        </div>
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
