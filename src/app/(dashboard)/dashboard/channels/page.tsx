"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { TablePagination } from "@/components/table-pagination";
import { toast } from "sonner";
import {
  Users,
  ShieldCheck,
  ShieldOff,
  Pencil,
  Trash2,
  Crown,
  RefreshCw,
  Search,
  MoreHorizontal,
  X,
  Filter,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
import { useT } from "@/lib/i18n";

const PAGE_SIZE = 20;

interface ChannelRow {
  id: string;
  agent_id: string;
  platform: string;
  platform_uid: string;
  display_name: string | null;
  user_soul: string;
  is_allowed: boolean;
  is_owner: boolean;
  created_at: string;
  updated_at: string;
  agents: { name: string } | null;
}

interface AgentOption {
  id: string;
  name: string;
}

const PLATFORMS: { key: string; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: "telegram", label: "Telegram", icon: TelegramIcon },
  { key: "feishu", label: "Feishu", icon: FeishuIcon },
  { key: "wecom", label: "WeCom", icon: WeComIcon },
  { key: "slack", label: "Slack", icon: SlackIcon },
  { key: "qqbot", label: "QQBot", icon: QQBotIcon },
  { key: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon },
];

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

function StatusBadge({ ch, t }: { ch: ChannelRow; t: ReturnType<typeof useT> }) {
  if (ch.is_allowed) {
    return <Badge variant="secondary" className="text-xs">{t("channels.allowed")}</Badge>;
  }
  if (!ch.user_soul) {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs">
        {t("channels.pending")}
      </Badge>
    );
  }
  return <Badge variant="destructive" className="text-xs">{t("channels.blocked")}</Badge>;
}

function PlatformBadge({ platform }: { platform: string }) {
  const plat = PLATFORM_MAP[platform];
  const Icon = plat?.icon;
  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon className="size-3.5" />}
      <span className="text-xs">{plat?.label ?? platform}</span>
    </span>
  );
}

export default function ChannelsPage() {
  const t = useT();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [soulDialog, setSoulDialog] = useState<ChannelRow | null>(null);
  const [soulText, setSoulText] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);
  const [ownerTarget, setOwnerTarget] = useState<ChannelRow | null>(null);

  useEffect(() => {
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((d) =>
        setAgents(
          (d.agents ?? []).map((a: { id: string; name: string }) => ({
            id: a.id,
            name: a.name,
          }))
        )
      )
      .catch(() => {});
  }, []);

  const fetchChannels = useCallback(
    async (p: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          page_size: String(PAGE_SIZE),
        });
        if (filterAgent && filterAgent !== "all") params.set("agent_id", filterAgent);
        if (filterPlatform && filterPlatform !== "all") params.set("platform", filterPlatform);
        if (searchQuery) params.set("search", searchQuery);

        const res = await fetch(`/api/admin/channels?${params}`);
        const data = await res.json();
        setChannels(data.channels ?? []);
        setTotal(data.total ?? 0);
      } catch {
        toast.error(t("channels.loadFailed"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t, filterAgent, filterPlatform, searchQuery]
  );

  const filtersKey = `${filterAgent}|${filterPlatform}|${searchQuery}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    if (page !== 1) {
      setPage(1);
    }
  }

  useEffect(() => {
    fetchChannels(page);
  }, [page, fetchChannels]);

  const handleRefresh = () => fetchChannels(page, true);

  const handleSearch = () => {
    setSearchQuery(searchInput.trim());
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const hasActiveFilters = useMemo(
    () => filterAgent !== "all" || filterPlatform !== "all" || !!searchQuery,
    [filterAgent, filterPlatform, searchQuery]
  );

  const clearAllFilters = () => {
    setFilterAgent("all");
    setFilterPlatform("all");
    setSearchInput("");
    setSearchQuery("");
  };

  const toggleAllowed = async (ch: ChannelRow) => {
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id, is_allowed: !ch.is_allowed }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(
        ch.is_allowed
          ? t("channels.channelBlocked")
          : t("channels.channelAllowed")
      );
      fetchChannels(page, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const openSoul = (ch: ChannelRow) => {
    setSoulDialog(ch);
    setSoulText(ch.user_soul || "");
  };

  const saveSoul = async () => {
    if (!soulDialog) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: soulDialog.id, user_soul: soulText }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(t("channels.soulUpdated"));
      setSoulDialog(null);
      fetchChannels(page, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteChannel = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/channels?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("channels.channelDeleted"));
      setDeleteTarget(null);
      fetchChannels(page, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    }
  };

  const confirmToggleOwner = async () => {
    if (!ownerTarget) return;
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: ownerTarget.id,
          is_owner: !ownerTarget.is_owner,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(
        ownerTarget.is_owner
          ? t("channels.ownerRevoked")
          : t("channels.ownerSet")
      );
      setOwnerTarget(null);
      fetchChannels(page, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("channels.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("channels.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 self-start sm:self-auto"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {t("channels.refresh")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("channels.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-8 pr-8"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterAgent} onValueChange={(v) => setFilterAgent(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-[160px]">
                {filterAgent === "all" ? t("channels.allAgents") : agents.find((a) => a.id === filterAgent)?.name || filterAgent}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("channels.allAgents")}
                </SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={(v) => setFilterPlatform(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-[140px]">
                {filterPlatform === "all" ? t("channels.allPlatforms") : (
                  (() => {
                    const p = PLATFORMS.find((p) => p.key === filterPlatform);
                    return p ? (
                      <span className="flex items-center gap-2">
                        <p.icon className="size-4" />
                        {p.label}
                      </span>
                    ) : filterPlatform;
                  })()
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("channels.allPlatforms")}
                </SelectItem>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    <p.icon className="size-4" />
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {hasActiveFilters && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="size-3.5" />
            <span>{t("channels.activeFilters")}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-xs"
              onClick={clearAllFilters}
            >
              {t("channels.clearFilters")}
            </Button>
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-lg border p-3"
            >
              <Skeleton className="hidden size-8 rounded-full sm:block" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Users className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">
                {hasActiveFilters
                  ? t("channels.noResults")
                  : t("channels.noChannels")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasActiveFilters
                  ? t("channels.noResultsHint")
                  : t("channels.noChannelsHint")}
              </p>
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                {t("channels.clearFilters")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table header */}
          <div className="hidden text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[1fr_120px_100px_100px_120px_48px] lg:gap-4 lg:border-b lg:px-3 lg:pb-2">
            <span>{t("channels.columnUser")}</span>
            <span>{t("channels.columnAgent")}</span>
            <span>{t("channels.columnPlatform")}</span>
            <span>{t("channels.columnStatus")}</span>
            <span>{t("channels.columnCreated")}</span>
            <span />
          </div>

          <div className="space-y-1.5 lg:space-y-0 lg:divide-y lg:rounded-lg lg:border">
            <TooltipProvider delay={300}>
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  className="group rounded-lg border p-3 transition-colors hover:bg-muted/40 lg:grid lg:grid-cols-[1fr_120px_100px_100px_120px_48px] lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:px-3 lg:py-2.5"
                >
                  {/* User info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium sm:flex">
                      {(ch.display_name || ch.platform_uid)
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {ch.display_name || "Unknown"}
                        </span>
                        {ch.is_owner && (
                          <Tooltip>
                            <TooltipTrigger render={<span />}>
                              <Crown className="size-3.5 shrink-0 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>{t("channels.ownerBadge")}</TooltipContent>
                          </Tooltip>
                        )}
                        {ch.user_soul && (
                          <Tooltip>
                            <TooltipTrigger render={<span />} className="size-1.5 shrink-0 rounded-full bg-violet-400" />
                            <TooltipContent>{t("channels.hasSoul")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {ch.platform_uid}
                      </p>
                    </div>
                  </div>

                  {/* Mobile-only meta row */}
                  <div className="mt-2 flex flex-wrap items-center gap-2 lg:hidden">
                    <PlatformBadge platform={ch.platform} />
                    <StatusBadge ch={ch} t={t} />
                    {ch.is_owner && (
                      <Badge variant="default" className="gap-1 text-xs bg-amber-500 hover:bg-amber-600">
                        <Crown className="size-3" />
                        {t("channels.ownerBadge")}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {ch.agents?.name ?? "N/A"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(ch.created_at)}
                    </span>
                  </div>

                  {/* Desktop columns */}
                  <span className="hidden truncate text-sm lg:block">
                    {ch.agents?.name ?? "N/A"}
                  </span>
                  <span className="hidden lg:block">
                    <PlatformBadge platform={ch.platform} />
                  </span>
                  <span className="hidden lg:block">
                    <StatusBadge ch={ch} t={t} />
                  </span>
                  <span className="hidden text-xs text-muted-foreground lg:block">
                    {formatDate(ch.created_at)}
                  </span>

                  {/* Actions */}
                  <div className="mt-2 flex items-center gap-1 lg:mt-0 lg:justify-end">
                    {/* Quick toggle on mobile */}
                    <Button
                      variant={ch.is_allowed ? "destructive" : "default"}
                      size="sm"
                      className="gap-1 lg:hidden"
                      onClick={() => toggleAllowed(ch)}
                    >
                      {ch.is_allowed ? (
                        <ShieldOff className="size-3.5" />
                      ) : (
                        <ShieldCheck className="size-3.5" />
                      )}
                      {ch.is_allowed
                        ? t("channels.block")
                        : t("channels.allow")}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => toggleAllowed(ch)}
                        >
                          {ch.is_allowed ? (
                            <ShieldOff className="mr-2 size-4" />
                          ) : (
                            <ShieldCheck className="mr-2 size-4" />
                          )}
                          {ch.is_allowed
                            ? t("channels.block")
                            : t("channels.allow")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setOwnerTarget(ch)}
                        >
                          <Crown className="mr-2 size-4" />
                          {ch.is_owner
                            ? t("channels.revokeOwner")
                            : t("channels.setOwner")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openSoul(ch)}>
                          <Pencil className="mr-2 size-4" />
                          {t("channels.editSoul")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(ch)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 size-4" />
                          {t("channels.deleteChannel")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </TooltipProvider>
          </div>

          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}

      {/* Soul edit dialog */}
      <Dialog
        open={!!soulDialog}
        onOpenChange={(open) => !open && setSoulDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("channels.editSoulTitle")} --{" "}
              {soulDialog?.display_name || soulDialog?.platform_uid}
            </DialogTitle>
            <DialogDescription>
              {t("channels.editSoulDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t("channels.soulProfile")}</Label>
              <Textarea
                rows={10}
                className="max-h-64 resize-y"
                value={soulText}
                onChange={(e) => setSoulText(e.target.value)}
                placeholder={t("channels.soulPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSoulDialog(null)}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveSoul}
              disabled={saving}
              className="w-full sm:w-auto"
            >
              {saving ? t("common.saving") : t("channels.saveSoul")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("channels.deleteChannel")}
        description={t("channels.deleteChannelConfirm", {
          name:
            deleteTarget?.display_name ||
            deleteTarget?.platform_uid ||
            "",
        })}
        confirmText={t("common.delete")}
        onConfirm={confirmDeleteChannel}
      />

      <ConfirmDialog
        open={!!ownerTarget}
        onOpenChange={(open) => !open && setOwnerTarget(null)}
        title={
          ownerTarget?.is_owner
            ? t("channels.revokeOwner")
            : t("channels.setOwner")
        }
        description={
          ownerTarget?.is_owner
            ? t("channels.revokeOwnerConfirm", {
                name:
                  ownerTarget?.display_name ||
                  ownerTarget?.platform_uid ||
                  "",
              })
            : t("channels.setOwnerConfirm", {
                name:
                  ownerTarget?.display_name ||
                  ownerTarget?.platform_uid ||
                  "",
              })
        }
        variant="default"
        onConfirm={confirmToggleOwner}
      />
    </div>
  );
}
