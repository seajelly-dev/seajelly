"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, MessageSquare, Radio } from "lucide-react";
import { useT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

interface RecentEvent {
  id: string;
  source: string;
  status: string;
  trace_id: string;
  created_at: string;
}

export default function DashboardPage() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ agents: 0, sessions: 0, events: 0 });
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [agents, sessions, events, recent] = await Promise.all([
      supabase.from("agents").select("*", { count: "exact", head: true }),
      supabase.from("sessions").select("*", { count: "exact", head: true }),
      supabase.from("events").select("*", { count: "exact", head: true }),
      supabase
        .from("events")
        .select("id, source, status, trace_id, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setStats({
      agents: agents.count ?? 0,
      sessions: sessions.count ?? 0,
      events: events.count ?? 0,
    });
    setRecentEvents((recent.data as RecentEvent[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-16" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("overview.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("overview.subtitle")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={t("overview.agents")}
          value={stats.agents}
          desc={t("overview.agentsDesc")}
          icon={<Bot className="size-4 text-primary" />}
        />
        <StatCard
          title={t("overview.sessions")}
          value={stats.sessions}
          desc={t("overview.sessionsDesc")}
          icon={<MessageSquare className="size-4 text-primary" />}
        />
        <StatCard
          title={t("overview.events")}
          value={stats.events}
          desc={t("overview.eventsDesc")}
          icon={<Radio className="size-4 text-primary" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("overview.recentEvents")}</CardTitle>
          <CardDescription>{t("overview.recentEventsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length > 0 ? (
            <div className="flex flex-col gap-2">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{event.source}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {event.trace_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={event.status} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("overview.noEvents")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  desc,
  icon,
}: {
  title: string;
  value: number;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription>{title}</CardDescription>
          {icon}
        </div>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "processed"
      ? "default"
      : status === "failed" || status === "dead"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
