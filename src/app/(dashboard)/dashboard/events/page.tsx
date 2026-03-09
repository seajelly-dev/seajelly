"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/table-pagination";
import { toast } from "sonner";
import { RefreshCw, RotateCcw, Radio, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n";
import type { AgentEvent } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const STATUS_OPTIONS = [
  "all",
  "pending",
  "processing",
  "processed",
  "failed",
  "dead",
];

const PAGE_SIZE = 20;

export default function EventsPage() {
  const t = useT();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedError, setSelectedError] = useState<string | null>(null);

  const fetchEvents = useCallback(
    async (p: number) => {
      setLoading(true);
      const supabase = createClient();

      let countQuery = supabase
        .from("events")
        .select("id", { count: "exact", head: true });
      if (statusFilter !== "all") {
        countQuery = countQuery.eq("status", statusFilter);
      }
      const { count } = await countQuery;
      setTotal(count ?? 0);

      const from = (p - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) {
        toast.error(t("events.loadFailed"));
      } else {
        setEvents((data as AgentEvent[]) ?? []);
      }
      setLoading(false);
    },
    [statusFilter, t]
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchEvents(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  const handleReplay = async (eventId: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("events")
      .update({ status: "pending", retry_count: 0, error_message: null })
      .eq("id", eventId);

    if (error) {
      toast.error(t("events.replayFailed"));
    } else {
      toast.success(t("events.replaySuccess"));
      fetchEvents(page);
    }
  };

  const handleCopyError = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("events.copySuccess")),
      () => toast.error(t("events.copyFailed"))
    );
  };

  const statusVariant = (status: string) => {
    if (status === "processed") return "default" as const;
    if (status === "failed" || status === "dead") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("events.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("events.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "all")}
          >
            <SelectTrigger
              id="events-status-filter-trigger"
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? t("events.allStatus") : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => fetchEvents(page)}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("events.eventLog")}</CardTitle>
          <CardDescription>{t("events.eventLogDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Radio className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("events.noEvents")}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("events.traceId")}</TableHead>
                      <TableHead>{t("events.source")}</TableHead>
                      <TableHead>{t("events.status")}</TableHead>
                      <TableHead>{t("events.retries")}</TableHead>
                      <TableHead>{t("events.error")}</TableHead>
                      <TableHead>{t("events.created")}</TableHead>
                      <TableHead className="text-right">
                        {t("common.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">
                          {e.trace_id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.source}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(e.status)}>
                            {e.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {e.retry_count}/{e.max_retries}
                        </TableCell>
                        <TableCell 
                          className="max-w-48 truncate text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline transition-colors"
                          onClick={() => e.error_message && setSelectedError(e.error_message)}
                        >
                          {e.error_message || "--"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {(e.status === "failed" ||
                            e.status === "dead") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => handleReplay(e.id)}
                            >
                              <RotateCcw className="size-3.5" />
                              {t("events.replay")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedError} onOpenChange={(open) => !open && setSelectedError(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("events.errorDetail")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-muted/50 p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
              {selectedError}
            </pre>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => selectedError && handleCopyError(selectedError)}
            >
              <Copy className="size-3.5" />
              {t("common.copy")}
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => setSelectedError(null)}
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
