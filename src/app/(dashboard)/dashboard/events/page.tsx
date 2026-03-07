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
import { toast } from "sonner";
import { RefreshCw, RotateCcw, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n";
import type { AgentEvent } from "@/types/database";

const STATUS_OPTIONS = [
  "all",
  "pending",
  "processing",
  "processed",
  "failed",
  "dead",
];

export default function EventsPage() {
  const t = useT();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchEvents = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

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
  }, [statusFilter, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEvents();
  }, [fetchEvents]);

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
      fetchEvents();
    }
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
          <h1 className="text-2xl font-semibold tracking-tight">{t("events.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("events.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "all")}
          >
            <SelectTrigger id="events-status-filter-trigger" className="w-36">
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
          <Button variant="outline" onClick={fetchEvents} className="gap-1.5">
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
              <p className="text-sm text-muted-foreground">{t("events.noEvents")}</p>
            </div>
          ) : (
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
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
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
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {e.error_message || "--"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {(e.status === "failed" || e.status === "dead") && (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
