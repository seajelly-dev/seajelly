"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/database";

interface AgentBindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: string | null;
  targetName?: string | null;
  title: string;
  description: string;
  noAgentsText: string;
  agents: Agent[];
  agentsLoading: boolean;
  loadSelectedAgentIds: (targetId: string) => Promise<string[]>;
  onSave: (targetId: string, agentIds: string[]) => Promise<void>;
}

function AgentBindingListSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-5 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function AgentBindingDialog({
  open,
  onOpenChange,
  targetId,
  targetName,
  title,
  description,
  noAgentsText,
  agents,
  agentsLoading,
  loadSelectedAgentIds,
  onSave,
}: AgentBindingDialogProps) {
  const t = useT();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSelection = useCallback(async () => {
    if (!open || !targetId) return;

    setSelectionLoading(true);
    setLoadError(null);
    setSelectedAgentIds([]);

    try {
      const agentIds = await loadSelectedAgentIds(targetId);
      setSelectedAgentIds(agentIds);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : t("bindingDialog.loadFailed")
      );
    } finally {
      setSelectionLoading(false);
    }
  }, [loadSelectedAgentIds, open, t, targetId]);

  useEffect(() => {
    if (!open || !targetId) return;

    let active = true;

    const run = async () => {
      setSelectionLoading(true);
      setLoadError(null);
      setSelectedAgentIds([]);

      try {
        const agentIds = await loadSelectedAgentIds(targetId);
        if (!active) return;
        setSelectedAgentIds(agentIds);
      } catch (err) {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : t("bindingDialog.loadFailed")
        );
      } finally {
        if (!active) return;
        setSelectionLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [loadSelectedAgentIds, open, t, targetId]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);

    if (!nextOpen) {
      setSelectedAgentIds([]);
      setSelectionLoading(false);
      setLoadError(null);
      setSaving(false);
    }
  };

  const interactionDisabled =
    agentsLoading || selectionLoading || saving || !!loadError;

  const toggleAgent = (agentId: string) => {
    if (interactionDisabled) return;

    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleSave = async () => {
    if (!targetId || interactionDisabled) return;

    setSaving(true);
    try {
      await onSave(targetId, selectedAgentIds);
      handleOpenChange(false);
    } catch {
      /* parent handles toast */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {title}
            {targetName ? ` — ${targetName}` : ""}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {agentsLoading || selectionLoading ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed bg-muted/30 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span>{t("bindingDialog.loadingBindings")}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("bindingDialog.loadingBindingsHint")}
              </p>
            </div>
            <AgentBindingListSkeleton />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4">
            <p className="text-sm font-medium text-destructive">
              {t("bindingDialog.loadFailed")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void loadSelection()}
              disabled={saving}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("common.retry")}
            </Button>
          </div>
        ) : agents.length === 0 ? (
          <div className="py-4">
            <p className="text-sm text-muted-foreground">{noAgentsText}</p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("bindingDialog.selectionHint")}
            </div>
            <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1">
              {agents.map((agent) => {
                const selected = selectedAgentIds.includes(agent.id);

                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={interactionDisabled}
                    onClick={() => toggleAgent(agent.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
                      selected
                        ? "border-primary bg-primary/10 shadow-sm shadow-primary/10"
                        : "border-border bg-background hover:border-foreground/15 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30 bg-background text-transparent"
                        )}
                      >
                        <Check className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {agent.name}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {agent.model}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-3 gap-1 border text-xs",
                        selected
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "border-border bg-background text-muted-foreground"
                      )}
                    >
                      {selected ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <Circle className="size-3" />
                      )}
                      {selected
                        ? t("bindingDialog.bound")
                        : t("bindingDialog.notBound")}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={interactionDisabled}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
