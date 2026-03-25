"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, MessageSquare, Radio, Zap, ArrowUpRight, ArrowDownRight, Clock, Webhook, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  WeixinIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
import { useT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultLegendContent";

interface RecentEvent {
  id: string;
  source: string;
  status: string;
  trace_id: string;
  created_at: string;
}

interface HourlyRow {
  hour: string;
  model_id: string;
  call_count: number;
  avg_duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

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
  slack: "Slack",
  qqbot: "QQBot",
  cron: "Cron",
  webhook: "Webhook",
  manual: "Manual",
};

// 高区分度颜色调色板，色相均匀分散
const MODEL_COLORS = [
  "#2563eb", // 蓝
  "#16a34a", // 绿
  "#ea580c", // 橙
  "#9333ea", // 紫
  "#dc2626", // 红
  "#0891b2", // 青
  "#ca8a04", // 黄
  "#be185d", // 粉
];

// Token 用量图表的 input/output 对比色
const TOKEN_INPUT_COLORS = [
  "#2563eb", // 蓝 - 深
  "#16a34a", // 绿 - 深
  "#ea580c", // 橙 - 深
  "#9333ea", // 紫 - 深
  "#dc2626", // 红 - 深
  "#0891b2", // 青 - 深
  "#ca8a04", // 黄 - 深
  "#be185d", // 粉 - 深
];
const TOKEN_OUTPUT_COLORS = [
  "#93c5fd", // 蓝 - 浅
  "#86efac", // 绿 - 浅
  "#fdba74", // 橙 - 浅
  "#c4b5fd", // 紫 - 浅
  "#fca5a5", // 红 - 浅
  "#67e8f9", // 青 - 浅
  "#fde047", // 黄 - 浅
  "#f9a8d4", // 粉 - 浅
];

export default function DashboardPage() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ agents: 0, sessions: 0, events: 0 });
  const [usage, setUsage] = useState({ total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 });
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyRow[]>([]);
  // 追踪被隐藏的模型（用于图例点击交互）
  const [hiddenDurationModels, setHiddenDurationModels] = useState<Set<string>>(new Set());
  const [hiddenTokenModels, setHiddenTokenModels] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (isInitial = false) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("dashboard_stats");
    if (error) {
      console.error("dashboard_stats error:", error.message);
      if (isInitial) setLoading(false);
      return;
    }
    const d = data as Record<string, unknown>;
    setStats({
      agents: Number(d.agents) || 0,
      sessions: Number(d.sessions) || 0,
      events: Number(d.events) || 0,
    });
    setUsage({
      total_calls: Number(d.today_calls) || 0,
      total_input_tokens: Number(d.today_input_tokens) || 0,
      total_output_tokens: Number(d.today_output_tokens) || 0,
    });
    setRecentEvents((d.recent_events as RecentEvent[]) ?? []);
    setHourlyData((d.hourly as HourlyRow[]) ?? []);
    if (isInitial) setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(true).catch(console.error);
  }, [fetchData]);
  const modelNames = useMemo(
    () => [...new Set(hourlyData.map((r) => r.model_id))].sort(),
    [hourlyData],
  );

  const { durationRows, tokenRows } = useMemo(() => {
    const hourMap = new Map<string, Record<string, number>>();
    const tokenMap = new Map<string, Record<string, number>>();

    for (const r of hourlyData) {
      const hk = r.hour;
      if (!hourMap.has(hk)) hourMap.set(hk, { _ts: new Date(hk).getTime() });
      if (!tokenMap.has(hk)) tokenMap.set(hk, { _ts: new Date(hk).getTime() });

      const dRow = hourMap.get(hk)!;
      dRow[r.model_id] = Number(r.avg_duration_ms) || 0;

      const tRow = tokenMap.get(hk)!;
      tRow[`${r.model_id}_in`] = Number(r.total_input_tokens) || 0;
      tRow[`${r.model_id}_out`] = Number(r.total_output_tokens) || 0;
    }

    const sortByTs = (a: Record<string, number>, b: Record<string, number>) => (a._ts ?? 0) - (b._ts ?? 0);
    return {
      durationRows: [...hourMap.values()].sort(sortByTs),
      tokenRows: [...tokenMap.values()].sort(sortByTs),
    };
  }, [hourlyData]);

  const formatHour = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  };

  // 图例点击切换模型显示/隐藏
  const handleDurationLegendClick = useCallback((data: Payload) => {
    const modelId = data.value as string;
    setHiddenDurationModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  const handleTokenLegendClick = useCallback((data: Payload) => {
    // 图例 value 格式为 "model_in" 或 "model_out"，提取模型名
    const raw = data.value as string;
    const modelId = raw.replace(/_in$|_out$/, "");
    setHiddenTokenModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
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
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{t("overview.title")}</h1>
          <p className="text-muted-foreground">
            {t("overview.subtitle")}
          </p>
        </div>
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

      {hourlyData.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("overview.avgResponseTime")}</CardTitle>
              <CardDescription>{t("overview.avgResponseTimeDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={durationRows}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="_ts" tickFormatter={formatHour} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" unit="ms" width={55} />
                    <Tooltip
                      labelFormatter={(v) => formatHour(v as number)}
                      formatter={(v: number) => [`${v.toLocaleString()} ms`]}
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border)" }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                      onClick={handleDurationLegendClick}
                      formatter={(value: string) => (
                        <span style={{ color: hiddenDurationModels.has(value) ? "#ccc" : undefined, textDecoration: hiddenDurationModels.has(value) ? "line-through" : undefined }}>
                          {value}
                        </span>
                      )}
                    />
                    {modelNames.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        name={name}
                        stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        hide={hiddenDurationModels.has(name)}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("overview.tokenUsage")}</CardTitle>
              <CardDescription>{t("overview.tokenUsageDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tokenRows}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="_ts" tickFormatter={formatHour} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" width={55} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip
                      labelFormatter={(v) => formatHour(v as number)}
                      formatter={(v: number, name: string) => {
                        const isInput = name.endsWith("_in");
                        const label = isInput ? "Input" : "Output";
                        const modelName = name.replace(/_in$|_out$/, "");
                        return [`${v.toLocaleString()}`, `${modelName} ${label}`];
                      }}
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border)" }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                      onClick={handleTokenLegendClick}
                      formatter={(value: string) => {
                        const isInput = value.endsWith("_in");
                        const modelName = value.replace(/_in$|_out$/, "");
                        const isHidden = hiddenTokenModels.has(modelName);
                        return (
                          <span style={{ color: isHidden ? "#ccc" : undefined, textDecoration: isHidden ? "line-through" : undefined }}>
                            {modelName} {isInput ? "Input" : "Output"}
                          </span>
                        );
                      }}
                    />
                    {modelNames.flatMap((name, i) => [
                      <Bar
                        key={`${name}_in`}
                        dataKey={`${name}_in`}
                        name={`${name}_in`}
                        fill={TOKEN_INPUT_COLORS[i % TOKEN_INPUT_COLORS.length]}
                        hide={hiddenTokenModels.has(name)}
                      />,
                      <Bar
                        key={`${name}_out`}
                        dataKey={`${name}_out`}
                        name={`${name}_out`}
                        fill={TOKEN_OUTPUT_COLORS[i % TOKEN_OUTPUT_COLORS.length]}
                        hide={hiddenTokenModels.has(name)}
                      />,
                    ])}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                    {(() => {
                      const Icon = SOURCE_ICON[event.source] || null;
                      const label = SOURCE_LABEL[event.source] ?? event.source;
                      return (
                        <Badge variant="secondary" className="gap-1.5 px-2.5 py-0.5 font-medium">
                          {Icon && <Icon className="size-3.5" />}
                          {label}
                        </Badge>
                      );
                    })()}
                    <span className="font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      {event.trace_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge status={event.status} t={t as (key: string) => string} />
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

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const variant =
    status === "processed"
      ? "default"
      : status === "failed" || status === "dead"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{t(`events.status_${status}`) || status}</Badge>;
}
