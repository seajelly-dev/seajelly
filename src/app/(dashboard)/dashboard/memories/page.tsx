"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/table-pagination";
import { toast } from "sonner";
import { Brain, Trash2, Pencil, Search, Settings2, Globe, User } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";

const PAGE_SIZE = 20;

interface MemoryRow {
  id: string;
  agent_id: string;
  channel_id: string | null;
  scope: "channel" | "global";
  category: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  agents: { name: string } | null;
  channels: { display_name: string | null } | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  fact: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  preference: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  decision: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  summary: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

export default function MemoriesPage() {
  const t = useT();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterAgent, setFilterAgent] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [filterScope, setFilterScope] = useState<string>("");

  // Debounced state to trigger actual search
  const [debouncedFilters, setDebouncedFilters] = useState({
    agent: "",
    channel: "",
    scope: ""
  });

  const [editDialog, setEditDialog] = useState<MemoryRow | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);

  const [chLimit, setChLimit] = useState("25");
  const [glLimit, setGlLimit] = useState("25");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (data.settings) {
        setChLimit(data.settings.memory_inject_limit_channel ?? "25");
        setGlLimit(data.settings.memory_inject_limit_global ?? "25");
      }
    } catch { /* ignore */ } finally {
      setSettingsLoading(false);
    }
  }, []);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await Promise.all([
        fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "memory_inject_limit_channel", value: chLimit }),
        }),
        fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "memory_inject_limit_global", value: glLimit }),
        }),
      ]);
      toast.success(t("memories.settingsSaved"));
    } catch {
      toast.error(t("memories.settingsFailed"));
    } finally {
      setSettingsSaving(false);
    }
  };

  const fetchMemories = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ page: String(p), page_size: String(PAGE_SIZE) });
        if (debouncedFilters.agent) qs.set("agent_name", debouncedFilters.agent);
        if (debouncedFilters.channel) qs.set("channel_name", debouncedFilters.channel);
        if (debouncedFilters.scope && debouncedFilters.scope !== "all-scopes-placeholder") {
          qs.set("scope", debouncedFilters.scope);
        }
        const res = await fetch(`/api/admin/memories?${qs.toString()}`);
        const data = await res.json();
        setMemories(data.memories ?? []);
        setTotal(data.total ?? 0);
      } catch {
        toast.error(t("memories.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [debouncedFilters, t]
  );

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Debounce input changes — 使用函数式更新避免相同值时创建新引用
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedFilters((prev) => {
        if (prev.agent === filterAgent && prev.channel === filterChannel && prev.scope === filterScope) {
          return prev; // 值未变化，返回同一引用，不触发重渲染
        }
        return { agent: filterAgent, channel: filterChannel, scope: filterScope };
      });
    }, 800);
    return () => clearTimeout(handler);
  }, [filterAgent, filterChannel, filterScope]);

  // Actual search trigger on debounce or page change
  useEffect(() => {
    setPage(1);
    fetchMemories(1);
  }, [debouncedFilters, fetchMemories]);

  useEffect(() => {
    if (page !== 1) {
      fetchMemories(page);
    }
  }, [page, fetchMemories]);

  const doSearch = () => {
    setDebouncedFilters({ agent: filterAgent, channel: filterChannel, scope: filterScope });
  };

  const openEdit = (m: MemoryRow) => {
    setEditDialog(m);
    setEditContent(m.content);
    setEditCategory(m.category);
  };

  const saveEdit = async () => {
    if (!editDialog) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/memories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editDialog.id, content: editContent, category: editCategory }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(t("memories.memoryUpdated"));
      setEditDialog(null);
      fetchMemories(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/memories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(t("memories.memoryDeleted"));
      setDeleteTarget(null);
      fetchMemories(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("memories.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("memories.subtitle")}</p>
      </div>

      <div className="flex flex-col md:flex-row-reverse items-stretch gap-4">
        {/* Settings card */}
        <Card className="flex-1 w-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Settings2 className="size-5 text-muted-foreground" />
              <CardTitle className="text-base">{t("memories.settingsTitle")}</CardTitle>
            </div>
            <CardDescription className="line-clamp-1">{t("memories.settingsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {settingsLoading ? (
              <div className="flex gap-4">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-20" />
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                  <Label className="text-xs">{t("memories.channelLimit")}</Label>
                  <Input
                    type="number" min="0" max="200"
                    value={chLimit} onChange={(e) => setChLimit(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                  <Label className="text-xs">{t("memories.globalLimit")}</Label>
                  <Input
                    type="number" min="0" max="200"
                    value={glLimit} onChange={(e) => setGlLimit(e.target.value)}
                  />
                </div>
                <Button size="sm" className="shrink-0" onClick={saveSettings} disabled={settingsSaving}>
                  {settingsSaving ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className="flex-1 w-full">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Search className="size-5 text-muted-foreground" />
              <CardTitle className="text-base">{t("memories.filter")}</CardTitle>
            </div>
            <CardDescription className="invisible h-0 md:visible md:h-auto opacity-0 md:opacity-0 md:h-5">placeholder</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Agent</Label>
                <Input
                  placeholder={t("memories.filterAgentPlaceholder")}
                  className="w-32"
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Channel</Label>
                <Input
                  placeholder={t("memories.filterChannelPlaceholder")}
                  className="w-32"
                  value={filterChannel}
                  onChange={(e) => setFilterChannel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Scope</Label>
                <Select
                  value={filterScope}
                  onValueChange={(val) => { setFilterScope(val as string); }}
                >
                  <SelectTrigger className="h-9 w-32 px-3 text-sm">
                    <SelectValue placeholder={t("memories.allScope")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-scopes-placeholder">{t("memories.allScope")}</SelectItem>
                    <SelectItem value="channel">{t("memories.scopeChannel")}</SelectItem>
                    <SelectItem value="global">{t("memories.scopeGlobal")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={doSearch}>
                <Search className="mr-1 size-4" />
                {t("memories.search")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Memory list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("memories.listTitle")}</CardTitle>
          <CardDescription>{t("memories.listDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Brain className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{t("memories.noMemories")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((m) => (
                <div key={m.id} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="mt-0.5">
                    {m.scope === "global"
                      ? <Globe className="size-4 text-amber-500" />
                      : <User className="size-4 text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-xs font-normal">
                        {m.agents?.name || "—"}
                      </Badge>
                      {m.scope === "channel" && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          {m.channels?.display_name || m.channel_id?.slice(0, 8) || "—"}
                        </Badge>
                      )}
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[m.category] ?? CATEGORY_COLORS.other}`}>
                        {m.category}
                      </span>
                      <Badge variant={m.scope === "global" ? "default" : "outline"} className="text-xs">
                        {m.scope === "global" ? t("memories.scopeGlobal") : t("memories.scopeChannel")}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground line-clamp-2">{m.content}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => openEdit(m)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="mt-4">
              <TablePagination total={total} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editDialog} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("memories.editTitle")}</DialogTitle>
            <DialogDescription>{t("memories.editDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t("memories.category")}</Label>
              <Select
                value={editCategory}
                onValueChange={(val) => setEditCategory(val as string)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("memories.category")} />
                </SelectTrigger>
                <SelectContent>
                  {["fact", "preference", "decision", "summary", "other"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("memories.content")}</Label>
              <Textarea
                rows={5}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        title={t("memories.deleteTitle")}
        description={t("memories.deleteConfirm")}
        confirmText={t("common.delete")}
        onConfirm={confirmDelete}
        loading={deleting}
        variant="destructive"
      />
    </div>
  );
}
