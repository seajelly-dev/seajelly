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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/table-pagination";
import { toast } from "sonner";
import { Users, ShieldCheck, ShieldOff, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";

const PAGE_SIZE = 18;

interface ChannelRow {
  id: string;
  agent_id: string;
  platform: string;
  platform_uid: string;
  display_name: string | null;
  user_soul: string;
  is_allowed: boolean;
  created_at: string;
  updated_at: string;
  agents: { name: string } | null;
}

export default function ChannelsPage() {
  const t = useT();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [soulDialog, setSoulDialog] = useState<ChannelRow | null>(null);
  const [soulText, setSoulText] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);

  const fetchChannels = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/channels?page=${p}&page_size=${PAGE_SIZE}`
        );
        const data = await res.json();
        setChannels(data.channels ?? []);
        setTotal(data.total ?? 0);
      } catch {
        toast.error(t("channels.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchChannels(page);
  }, [page, fetchChannels]);

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
      fetchChannels(page);
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
      fetchChannels(page);
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
      fetchChannels(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("channels.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("channels.subtitle")}
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="mt-1 h-3 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-12 w-full" />
                <div className="mt-3 flex gap-1">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : channels.length === 0 && total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Users className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">{t("channels.noChannels")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("channels.noChannelsHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {channels.map((ch) => (
              <Card
                key={ch.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {ch.display_name || "Unknown"}
                        <Badge
                          variant={
                            ch.is_allowed ? "secondary" : "destructive"
                          }
                          className="text-xs"
                        >
                          {ch.is_allowed
                            ? t("channels.allowed")
                            : t("channels.blocked")}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs">
                        {ch.platform}:{ch.platform_uid}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">
                      {t("channels.agent")}:
                    </span>{" "}
                    {ch.agents?.name ?? "N/A"}
                  </div>

                  {ch.user_soul ? (
                    <div className="rounded-lg bg-muted/50 p-2.5 text-xs">
                      <span className="font-medium text-foreground/70">
                        {t("channels.userSoul")}:{" "}
                      </span>
                      <span className="text-muted-foreground">
                        {ch.user_soul.length > 120
                          ? ch.user_soul.slice(0, 120) + "..."
                          : ch.user_soul}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs italic text-muted-foreground">
                      {t("channels.noSoulProfile")}
                    </div>
                  )}

                  <div className="flex gap-1.5 pt-1">
                    <Button
                      variant={ch.is_allowed ? "destructive" : "default"}
                      size="sm"
                      className="gap-1"
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => openSoul(ch)}
                    >
                      <Pencil className="size-3.5" />
                      {t("channels.editSoul")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(ch)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}

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
        onConfirm={confirmDeleteChannel}
      />
    </div>
  );
}
