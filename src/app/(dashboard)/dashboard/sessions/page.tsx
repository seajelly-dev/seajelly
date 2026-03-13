"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/table-pagination";
import { toast } from "sonner";
import {
  MessageSquare,
  Bot,
  User,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
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

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

interface SessionSummaryData {
  version: 1;
  summary_text: string;
  updated_at: string;
  summarized_message_count: number;
  retained_recent_count: number;
  last_compacted_session_version: number;
  model_id: string;
}

interface SessionMetadata {
  session_summary?: SessionSummaryData | null;
  [key: string]: unknown;
}

interface SessionRow {
  id: string;
  platform_chat_id: string;
  agent_id: string;
  channel_id: string | null;
  version: number;
  is_active: boolean;
  updated_at: string;
  messages: ChatMessage[];
  metadata?: SessionMetadata | null;
  active_skill_ids: string[];
  agents: { name: string } | null;
  channels: { platform: string; display_name: string | null } | null;
}

const PLATFORM_ICON: Record<string, React.FC<{ className?: string }>> = {
  telegram: TelegramIcon,
  feishu: FeishuIcon,
  wecom: WeComIcon,
  slack: SlackIcon,
  qqbot: QQBotIcon,
  whatsapp: WhatsAppIcon,
};

function normalizeSessionRow(session: SessionRow): SessionRow {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages : [],
    metadata:
      session.metadata && typeof session.metadata === "object"
        ? session.metadata
        : null,
  };
}

export default function SessionsPage() {
  const t = useT();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SessionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeSkillNames, setActiveSkillNames] = useState<{ id: string; name: string }[]>([]);

  const fetchSessions = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/sessions?page=${p}&page_size=${PAGE_SIZE}`
        );
        const data = await res.json();
        const rows = (data.sessions ?? []).map((s: SessionRow) =>
          normalizeSessionRow(s)
        );
        setSessions(rows);
        setTotal(data.total ?? 0);
      } catch {
        toast.error(t("sessions.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const fetchDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setActiveSkillNames([]);
      try {
        const res = await fetch(`/api/admin/sessions?id=${id}`);
        const data = await res.json();
        if (data.session) {
          setSelectedDetail(normalizeSessionRow(data.session as SessionRow));
          if (Array.isArray(data.active_skills)) {
            setActiveSkillNames(data.active_skills);
          }
        }
      } catch {
        toast.error(t("sessions.loadFailed"));
      } finally {
        setDetailLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchSessions(page);
  }, [page, fetchSessions]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    } else {
      setSelectedDetail(null);
    }
  }, [selectedId, fetchDetail]);

  const handlePageChange = (p: number) => setPage(p);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("sessions.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sessions.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchSessions(page)}
        >
          <RefreshCw className="mr-2 size-4" />
          {t("common.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.allSessions")}</CardTitle>
          <CardDescription>{t("sessions.allSessionsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : sessions.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">ID</TableHead>
                    <TableHead>{t("sessions.chatId")}</TableHead>
                    <TableHead>{t("sessions.agent")}</TableHead>
                    <TableHead>{t("sessions.messages")}</TableHead>
                    <TableHead>{t("sessions.status")}</TableHead>
                    <TableHead>{t("sessions.lastUpdated")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => setSelectedId(s.id)}
                    >
                      <TableCell>
                        <CopyIdButton id={s.id} />
                      </TableCell>
                      <TableCell>
                        <ChatIdCell session={s} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {s.agents?.name ?? t("sessions.unknown")}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {s.messages.length}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.is_active ? "default" : "secondary"}
                        >
                          {s.is_active
                            ? t("sessions.active")
                            : t("sessions.archived")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.updated_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={handlePageChange}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("sessions.noSessions")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent
          side="right"
          className="data-[side=right]:sm:max-w-2xl flex flex-col"
        >
          <SheetHeader className="px-6">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              {t("sessions.chatHistory")}
            </SheetTitle>
            {selectedDetail && (
              <SheetDescription>
                {t("sessions.chatInfo", {
                  chatId: selectedDetail.platform_chat_id,
                  agent:
                    selectedDetail.agents?.name ?? t("sessions.unknown"),
                  count: selectedDetail.messages.length,
                })}
              </SheetDescription>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {detailLoading ? (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="size-8 animate-spin" />
                <p className="text-sm">{t("common.loading")}</p>
              </div>
            ) : selectedDetail ? (
              <div className="flex flex-col gap-4">
                {activeSkillNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/30 px-3 py-2">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">
                      {t("sessions.activeSkills")}:
                    </span>
                    {activeSkillNames.map((skill) => (
                      <Badge key={skill.id} variant="secondary" className="text-xs">
                        {skill.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {selectedDetail.metadata?.session_summary && (
                  <SessionSummaryCard
                    summary={selectedDetail.metadata.session_summary}
                  />
                )}
                {selectedDetail.messages.length > 0 ? (
                  selectedDetail.messages.map((msg, i) => (
                    <MessageBubble key={i} message={msg} />
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                    <MessageSquare className="size-8" />
                    <p className="text-sm">{t("sessions.noMessages")}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <MessageSquare className="size-8" />
                <p className="text-sm">{t("sessions.noMessages")}</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SessionSummaryCard({ summary }: { summary: SessionSummaryData }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border bg-muted/20">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {t("sessions.summaryTitle")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("sessions.summaryDesc")}
              </p>
            </div>
            <CollapsibleTrigger className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {open ? t("sessions.summaryHide") : t("sessions.summaryShow")}
              <ChevronDown
                className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {t("sessions.summaryUpdatedAt")}:{" "}
              {new Date(summary.updated_at).toLocaleString()}
            </Badge>
            <Badge variant="outline">
              {t("sessions.summaryCompressedCount")}:{" "}
              {summary.summarized_message_count}
            </Badge>
            <Badge variant="outline">
              {t("sessions.summaryRetainedCount")}:{" "}
              {summary.retained_recent_count}
            </Badge>
            <Badge variant="outline">
              {t("sessions.summaryModel")}: {summary.model_id}
            </Badge>
          </div>
        </div>

        <CollapsibleContent className="border-t px-4 py-4">
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {summary.summary_text}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={id}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          toast.success(`Copied: ${id.slice(0, 8)}...`);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function ChatIdCell({ session }: { session: SessionRow }) {
  const platform = session.channels?.platform;
  const displayName = session.channels?.display_name;
  const Icon = platform ? PLATFORM_ICON[platform] : null;

  if (Icon && displayName) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-4 shrink-0" />
        <span className="text-sm">{displayName}</span>
      </span>
    );
  }

  if (Icon) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-4 shrink-0" />
        <span className="font-mono text-sm">{session.platform_chat_id}</span>
      </span>
    );
  }

  return <span className="font-mono text-sm">{session.platform_chat_id}</span>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="mx-auto max-w-[90%] rounded-lg bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground italic">
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? (
          <User className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted rounded-tl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap wrap-break-word">
          {message.content}
        </p>
        {message.timestamp && (
          <p
            className={`mt-2 text-[10px] ${
              isUser
                ? "text-primary-foreground/60"
                : "text-muted-foreground/60"
            }`}
          >
            {new Date(message.timestamp).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
