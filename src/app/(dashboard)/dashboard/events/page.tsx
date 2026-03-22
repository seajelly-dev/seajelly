"use client";

import React, { useState, useEffect, useCallback } from "react";
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
import { RefreshCw, RotateCcw, Radio, Copy, Clock, Webhook, Hand, Search, XCircle } from "lucide-react";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  WeixinIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
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
import { Input } from "@/components/ui/input";

const STATUS_OPTIONS = [
  "all",
  "pending",
  "processing",
  "processed",
  "failed",
  "dead",
  "cancelled",
];

const SOURCE_ICON: Record<string, React.FC<{ className?: string }>> = {
  telegram: TelegramIcon,
  feishu: FeishuIcon,
  wecom: WeComIcon,
  weixin: WeixinIcon,
  slack: SlackIcon,
  qqbot: QQBotIcon,
  whatsapp: WhatsAppIcon,
  cron: Clock,
  webhook: Webhook,
  manual: Hand,
};

const SOURCE_LABEL: Record<string, string> = {
  telegram: "Telegram",
  feishu: "Feishu",
  wecom: "WeCom",
  weixin: "WeChat",
  slack: "Slack",
  qqbot: "QQBot",
  cron: "Cron",
  webhook: "Webhook",
  manual: "Manual",
};

const PAGE_SIZE = 20;

interface TraceStep {
  id: string;
  trace_id: string;
  step_no: number | null;
  phase: "model" | "tool";
  tool_name: string | null;
  tool_input_json: unknown;
  tool_output_json: unknown;
  model_text: string | null;
  status: "success" | "failed";
  error_message: string | null;
  latency_ms: number | null;
  created_at: string;
}

function extractArtifacts(step: TraceStep): { jobId?: string; sandboxId?: string; previewUrl?: string } {
  const out = step.tool_output_json;
  const list = Array.isArray(out) ? out : [];
  const artifacts: { jobId?: string; sandboxId?: string; previewUrl?: string } = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const payload = (rec.output ?? rec.result) as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== "object") continue;
    if (!artifacts.jobId && typeof payload.jobId === "string") artifacts.jobId = payload.jobId;
    if (!artifacts.sandboxId && typeof payload.sandboxId === "string") artifacts.sandboxId = payload.sandboxId;
    if (!artifacts.previewUrl && typeof payload.previewUrl === "string") artifacts.previewUrl = payload.previewUrl;
  }
  return artifacts;
}

export default function EventsPage() {
  const t = useT();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [traceTotal, setTraceTotal] = useState(0);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceToolFilter, setTraceToolFilter] = useState("");
  const [traceStatusFilter, setTraceStatusFilter] = useState("all");
  const [traceHasErrorFilter, setTraceHasErrorFilter] = useState("all");
  const [traceMinLatency, setTraceMinLatency] = useState("");
  const [traceMaxLatency, setTraceMaxLatency] = useState("");

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

  const fetchTraceSteps = useCallback(
    async (traceId: string) => {
      setTraceLoading(true);
      try {
        const params = new URLSearchParams({
          trace_id: traceId,
          page: "1",
          page_size: "200",
        });
        if (traceToolFilter.trim()) params.set("tool_name", traceToolFilter.trim());
        if (traceStatusFilter !== "all") params.set("status", traceStatusFilter);
        if (traceHasErrorFilter === "yes") params.set("has_error", "true");
        if (traceHasErrorFilter === "no") params.set("has_error", "false");
        if (traceMinLatency.trim()) params.set("min_latency_ms", traceMinLatency.trim());
        if (traceMaxLatency.trim()) params.set("max_latency_ms", traceMaxLatency.trim());

        const resp = await fetch(`/api/admin/trace-steps?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const json = (await resp.json()) as { steps?: TraceStep[]; total?: number; error?: string };
        if (!resp.ok) {
          throw new Error(json.error || "Failed to load trace steps");
        }
        setTraceSteps(json.steps ?? []);
        setTraceTotal(json.total ?? 0);
      } catch (error) {
        setTraceSteps([]);
        setTraceTotal(0);
        toast.error(error instanceof Error ? error.message : "Failed to load trace steps");
      } finally {
        setTraceLoading(false);
      }
    },
    [traceStatusFilter, traceToolFilter, traceHasErrorFilter, traceMinLatency, traceMaxLatency]
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchEvents(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  useEffect(() => {
    if (!selectedTraceId) return;
    fetchTraceSteps(selectedTraceId);
  }, [selectedTraceId, traceToolFilter, traceStatusFilter, traceHasErrorFilter, traceMinLatency, traceMaxLatency, fetchTraceSteps]);

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

  const handleCancel = async (eventId: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("events")
      .update({
        status: "cancelled",
        locked_until: null,
        error_message: "Manually cancelled by admin",
      })
      .eq("id", eventId)
      .eq("status", "processing");

    if (error) {
      toast.error(t("events.cancelFailed"));
    } else {
      toast.success(t("events.cancelSuccess"));
      fetchEvents(page);
    }
  };

  const handleCopyError = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("events.copySuccess")),
      () => toast.error(t("events.copyFailed"))
    );
  };

  const openTraceReview = (traceId: string) => {
    setTraceToolFilter("");
    setTraceStatusFilter("all");
    setTraceHasErrorFilter("all");
    setTraceMinLatency("");
    setTraceMaxLatency("");
    setSelectedTraceId(traceId);
  };

  const statusVariant = (status: string) => {
    if (status === "processed") return "default" as const;
    if (status === "failed" || status === "dead") return "destructive" as const;
    if (status === "cancelled") return "outline" as const;
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
              {statusFilter === "all" ? t("events.allStatus") : (t(`events.status_${statusFilter}` as never) || statusFilter)}
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? t("events.allStatus") : (t(`events.status_${s}` as never) || s)}
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
                          <button
                            type="button"
                            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                            onClick={() => openTraceReview(e.trace_id)}
                          >
                            {e.trace_id.slice(0, 8)}
                          </button>
                        </TableCell>
                        <TableCell>
                          <SourceCell source={e.source} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(e.status)}>
                            {t(`events.status_${e.status}` as never) || e.status}
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
                        <TableCell className="text-right space-x-1">
                          {e.status === "processing" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-destructive hover:text-destructive"
                              onClick={() => handleCancel(e.id)}
                            >
                              <XCircle className="size-3.5" />
                              {t("events.cancel")}
                            </Button>
                          )}
                          {(e.status === "failed" ||
                            e.status === "dead" ||
                            e.status === "cancelled") && (
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

      <Dialog open={!!selectedTraceId} onOpenChange={(open) => !open && setSelectedTraceId(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Trace Review</span>
              <span className="font-mono text-xs font-normal text-muted-foreground select-all">
                {selectedTraceId}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => selectedTraceId && handleCopyError("trace_id:" + selectedTraceId)}
              >
                <Copy className="size-3" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={traceToolFilter}
                onChange={(e) => setTraceToolFilter(e.target.value)}
                className="pl-8"
                placeholder="Filter by tool name"
              />
            </div>
            <Select value={traceStatusFilter} onValueChange={(v) => setTraceStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={traceHasErrorFilter} onValueChange={(v) => setTraceHasErrorFilter(v ?? "all")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Error" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All errors</SelectItem>
                <SelectItem value="yes">Only with error</SelectItem>
                <SelectItem value="no">Only without error</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="w-28"
              inputMode="numeric"
              placeholder="min ms"
              value={traceMinLatency}
              onChange={(e) => setTraceMinLatency(e.target.value.replace(/[^\d]/g, ""))}
            />
            <Input
              className="w-28"
              inputMode="numeric"
              placeholder="max ms"
              value={traceMaxLatency}
              onChange={(e) => setTraceMaxLatency(e.target.value.replace(/[^\d]/g, ""))}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectedTraceId && fetchTraceSteps(selectedTraceId)}
            >
              Refresh
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {traceTotal} steps
            </span>
          </div>
          <div className="max-h-[65vh] overflow-y-auto rounded-md border">
            {traceLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : traceSteps.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No steps found for this trace.</div>
            ) : (
              <div className="divide-y">
                {traceSteps.map((step) => {
                  const artifacts = extractArtifacts(step);
                  const toolInputText = JSON.stringify(step.tool_input_json ?? [], null, 2);
                  const toolOutputText = JSON.stringify(step.tool_output_json ?? [], null, 2);
                  const modelText = step.model_text ?? "";
                  return (
                    <div key={step.id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={step.status === "failed" ? "destructive" : "default"}>
                          {step.status}
                        </Badge>
                        <Badge variant="secondary">
                          step #{step.step_no ?? "-"}
                        </Badge>
                        <Badge variant="outline">
                          {step.phase}
                        </Badge>
                        {step.tool_name ? (
                          <span className="font-mono">{step.tool_name}</span>
                        ) : null}
                        <span className="ml-auto text-muted-foreground">
                          {step.latency_ms ?? 0} ms · {new Date(step.created_at).toLocaleString()}
                        </span>
                      </div>
                      {(artifacts.jobId || artifacts.sandboxId || artifacts.previewUrl) ? (
                        <div className="rounded-md bg-muted/50 p-3 text-xs">
                          {artifacts.jobId ? <div>job_id: <span className="font-mono">{artifacts.jobId}</span></div> : null}
                          {artifacts.sandboxId ? <div>sandbox_id: <span className="font-mono">{artifacts.sandboxId}</span></div> : null}
                          {artifacts.previewUrl ? (
                            <div>
                              preview_url:{" "}
                              <a className="underline" href={artifacts.previewUrl} target="_blank" rel="noreferrer">
                                {artifacts.previewUrl}
                              </a>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {step.error_message ? (
                        <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                          {step.error_message}
                        </div>
                      ) : null}
                      {modelText ? (
                        <div className="rounded-md bg-muted/40 p-3">
                          <div className="mb-1 text-xs text-muted-foreground">model_text</div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs">
                            {modelText.length > 6000 ? `${modelText.slice(0, 6000)}\n...<truncated>` : modelText}
                          </pre>
                        </div>
                      ) : null}
                      {toolInputText !== "[]" ? (
                        <div className="rounded-md bg-muted/40 p-3">
                          <div className="mb-1 text-xs text-muted-foreground">tool_input_json</div>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs">
                            {toolInputText.length > 8000 ? `${toolInputText.slice(0, 8000)}\n...<truncated>` : toolInputText}
                          </pre>
                        </div>
                      ) : null}
                      {toolOutputText !== "[]" ? (
                        <div className="rounded-md bg-muted/40 p-3">
                          <div className="mb-1 text-xs text-muted-foreground">tool_output_json</div>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs">
                            {toolOutputText.length > 8000 ? `${toolOutputText.slice(0, 8000)}\n...<truncated>` : toolOutputText}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

function SourceCell({ source }: { source: string }) {
  const Icon = SOURCE_ICON[source];
  const label = SOURCE_LABEL[source] ?? source;

  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span className="text-xs">{label}</span>
    </span>
  );
}
