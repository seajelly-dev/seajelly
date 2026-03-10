"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, MessageSquare, Radio, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
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
  const [usage, setUsage] = useState({ total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 });
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  useEffect(() => {
    const fetchData = async () => {
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

      try {
        const usageRes = await fetch("/api/admin/usage?range=today");
        if (usageRes.ok) {
          const usageData = await usageRes.json();
          setUsage({
            total_calls: usageData.total_calls ?? 0,
            total_input_tokens: usageData.total_input_tokens ?? 0,
            total_output_tokens: usageData.total_output_tokens ?? 0,
          });
        }
      } catch {}

      setLoading(false);
    };

    fetchData().catch(console.error);
  }, []);

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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="text-muted-foreground">
          {t("overview.subtitle")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title={t("overview.agents")}
          value={stats.agents}
          desc={t("overview.agentsDesc")}
          icon={<Bot className="size-5 text-primary" />}
        />
        <StatCard
          title={t("overview.sessions")}
          value={stats.sessions}
          desc={t("overview.sessionsDesc")}
          icon={<MessageSquare className="size-5 text-primary" />}
        />
        <StatCard
          title={t("overview.events")}
          value={stats.events}
          desc={t("overview.eventsDesc")}
          icon={<Radio className="size-5 text-primary" />}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          title={t("overview.apiCalls")}
          value={usage.total_calls}
          desc={t("overview.apiCallsDesc")}
          icon={<Zap className="size-5 text-primary" />}
        />
        <StatCard
          title={t("overview.inputTokens")}
          value={usage.total_input_tokens}
          desc={t("overview.inputTokensDesc")}
          icon={<ArrowUpRight className="size-5 text-primary" />}
        />
        <StatCard
          title={t("overview.outputTokens")}
          value={usage.total_output_tokens}
          desc={t("overview.outputTokensDesc")}
          icon={<ArrowDownRight className="size-5 text-primary" />}
        />
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">{t("overview.recentEvents")}</CardTitle>
          <CardDescription>{t("overview.recentEventsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-transparent bg-muted/30 px-5 py-4 text-sm transition-all hover:border-border hover:bg-muted/50 hover:shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <Badge variant="secondary" className="px-2.5 py-0.5 font-medium">{event.source}</Badge>
                    <span className="font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      {event.trace_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge status={event.status} />
                    <span className="text-xs text-muted-foreground font-medium">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted/50 p-4 mb-4">
                <Radio className="size-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("overview.noEvents")}
              </p>
            </div>
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
    <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-md hover:-translate-y-1 border-border/50 group">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium">{title}</CardDescription>
          <div className="rounded-xl bg-primary/10 p-2.5 transition-colors group-hover:bg-primary/20">
            {icon}
          </div>
        </div>
        <CardTitle className="text-4xl font-bold tracking-tight tabular-nums mt-2">{value.toLocaleString()}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardContent>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
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
