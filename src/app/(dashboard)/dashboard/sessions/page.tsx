"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MessageSquare, Bot, User } from "lucide-react";
import { useT } from "@/lib/i18n";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

interface SessionRow {
  id: string;
  platform_chat_id: string;
  agent_id: string;
  version: number;
  is_active: boolean;
  updated_at: string;
  messages: ChatMessage[];
  agents: { name: string } | null;
}

export default function SessionsPage() {
  const t = useT();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SessionRow | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sessions");
      const data = await res.json();
      const rows = (data.sessions ?? []).map((s: SessionRow) => ({
        ...s,
        messages: Array.isArray(s.messages) ? s.messages : [],
      }));
      setSessions(rows);
    } catch {
      toast.error(t("sessions.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("sessions.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("sessions.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.allSessions")}</CardTitle>
          <CardDescription>
            {t("sessions.allSessionsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
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
                    onClick={() => setSelected(s)}
                  >
                    <TableCell className="font-mono text-sm">
                      {s.platform_chat_id}
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
                      <Badge variant={s.is_active ? "default" : "secondary"}>
                        {s.is_active ? t("sessions.active") : t("sessions.archived")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(s.updated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{t("sessions.noSessions")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
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
            {selected && (
              <SheetDescription>
                {t("sessions.chatInfo", {
                  chatId: selected.platform_chat_id,
                  agent: selected.agents?.name ?? t("sessions.unknown"),
                  count: selected.messages.length,
                })}
              </SheetDescription>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {selected && selected.messages.length > 0 ? (
              <div className="flex flex-col gap-4">
                {selected.messages.map((msg, i) => (
                  <MessageBubble key={i} message={msg} />
                ))}
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
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted rounded-tl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
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
