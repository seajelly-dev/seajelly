"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Send,
  Users,
  Bot,
  MessageCircle,
  Lock,
  Loader2,
  ShieldCheck,
  Power,
  PowerOff,
  Globe,
  AlertTriangle,
} from "lucide-react";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
import type { ChatRoom, ChatRoomMessage } from "@/types/database";

const PLATFORM_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram: TelegramIcon,
  feishu: FeishuIcon,
  wecom: WeComIcon,
  slack: SlackIcon,
  qqbot: QQBotIcon,
  whatsapp: WhatsAppIcon,
};

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = PLATFORM_ICON_MAP[platform];
  if (Icon) return <Icon className={className} />;
  return <Globe className={className} />;
}

interface Identity {
  channel_id: string | null;
  platform: string;
  display_name: string;
  is_owner: boolean;
}

interface PresenceUser {
  nickname: string;
  platform: string;
  is_owner: boolean;
  joined_at: string;
}

export default function ChatRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.id as string;
  const tokenStr = searchParams.get("t") || "";

  const { t, locale, setLocale } = useI18n();

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [messages, setMessages] = useState<ChatRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "unauthorized" | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [nickname, setNickname] = useState("");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!identity) return;
    const saved = localStorage.getItem(`room_nick_${roomId}`);
    if (saved) {
      setNickname(saved);
      setNicknameConfirmed(true);
    } else {
      setNickname(identity.display_name);
    }
  }, [identity, roomId]);

  const fetchRoom = useCallback(async () => {
    if (!tokenStr) {
      setError("unauthorized");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/app/room?id=${roomId}&t=${encodeURIComponent(tokenStr)}`);
      if (res.status === 401) {
        setError("unauthorized");
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.room) {
        setError("not_found");
        return;
      }
      setRoom(data.room);
      setMessages(data.messages ?? []);
      if (data.agent) setAgentName(data.agent.name);
      if (data.identity) setIdentity(data.identity);
    } catch {
      setError("not_found");
    } finally {
      setLoading(false);
    }
  }, [roomId, tokenStr]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  const effectiveNickname = nicknameConfirmed ? nickname : identity?.display_name || "";

  useEffect(() => {
    if (!room || !nicknameConfirmed || !effectiveNickname) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatRoomMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (newMsg.sender_type === "system") {
            if (newMsg.content.toLowerCase().includes("closed")) {
              setRoom((r) => r ? { ...r, status: "closed", closed_at: new Date().toISOString() } : r);
            } else if (newMsg.content.toLowerCase().includes("reopen")) {
              setRoom((r) => r ? { ...r, status: "active", closed_at: null } : r);
            }
          }
        }
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const users: PresenceUser[] = [];
        for (const key in state) {
          for (const presence of state[key]) {
            users.push(presence);
          }
        }
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            nickname: effectiveNickname,
            platform: identity?.platform || "web",
            is_owner: identity?.is_owner || false,
            joined_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, nicknameConfirmed, roomId, effectiveNickname, identity]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleConfirmNickname = () => {
    const name = nickname.trim();
    if (!name) return;
    localStorage.setItem(`room_nick_${roomId}`, name);
    setNicknameConfirmed(true);
  };

  const handleSend = async () => {
    if (!inputText.trim() || sending || room?.status === "closed") return;
    const text = inputText.trim();
    setInputText("");
    setSending(true);

    try {
      const res = await fetch("/api/app/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          sender_name: effectiveNickname,
          platform: identity?.platform || "web",
          content: text,
          token: tokenStr,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err) {
      console.error("Send failed:", err);
      setInputText(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleRoomAction = async (action: "close" | "reopen") => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/app/room", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          action,
          token: tokenStr,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRoom((r) =>
        r
          ? {
              ...r,
              status: data.status,
              closed_at: data.status === "closed" ? new Date().toISOString() : null,
            }
          : r
      );
    } catch {
      // error handled via system message from realtime
    } finally {
      setActionLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error === "unauthorized") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertTriangle className="size-16 text-destructive/40 mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t("room.unauthorized")}</h2>
            <p className="text-muted-foreground">{t("room.unauthorizedDesc")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <MessageCircle className="size-16 text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t("room.notFound")}</h2>
            <p className="text-muted-foreground">{t("room.notFoundDesc")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!nicknameConfirmed && identity) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="max-w-sm w-full mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <MessageCircle className="size-7 text-primary" />
              </div>
            </div>
            <CardTitle className="text-xl">{t("room.joinTitle")}</CardTitle>
            {room?.title && (
              <p className="text-sm text-muted-foreground mt-1">{room.title}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <PlatformIcon platform={identity.platform} className="size-5 shrink-0" />
              <span className="text-sm font-medium capitalize">{identity.platform}</span>
              {identity.is_owner && (
                <Badge variant="secondary" className="ml-auto gap-1 text-xs">
                  <ShieldCheck className="size-3" />
                  {t("room.owner")}
                </Badge>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t("room.nickname")}</label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t("room.nicknamePlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleConfirmNickname()}
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              onClick={handleConfirmNickname}
              disabled={!nickname.trim()}
            >
              {t("room.join")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <MessageCircle className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {room?.title || t("room.title")}
            </h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {agentName && (
                <>
                  <Bot className="size-3" />
                  <span>{agentName}</span>
                  <span className="mx-1">·</span>
                </>
              )}
              {room?.status === "closed" ? (
                <span className="text-destructive flex items-center gap-1">
                  <Lock className="size-3" /> {t("room.closed")}
                </span>
              ) : (
                <span className="text-green-500">{t("room.active")}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Language switcher */}
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
            title={t("room.language")}
          >
            <Globe className="size-3.5" />
            <span>{locale === "zh" ? "EN" : "中"}</span>
          </button>

          {/* Owner controls */}
          {identity?.is_owner && (
            <>
              {room?.status === "active" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs text-destructive hover:text-destructive"
                  onClick={() => handleRoomAction("close")}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="size-3 animate-spin" /> : <PowerOff className="size-3" />}
                  <span className="hidden sm:inline">{t("room.closeRoom")}</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs text-green-600 hover:text-green-600"
                  onClick={() => handleRoomAction("reopen")}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
                  <span className="hidden sm:inline">{t("room.reopenRoom")}</span>
                </Button>
              )}
            </>
          )}

          <Badge variant="outline" className="gap-1 text-xs">
            <Users className="size-3" />
            {onlineUsers.length}
          </Badge>
          <div className="flex -space-x-1">
            {onlineUsers.slice(0, 5).map((u, i) => (
              <div
                key={`${u.nickname}-${i}`}
                title={`${u.nickname} (${u.platform})${u.is_owner ? " ★" : ""}`}
                className={`flex size-7 items-center justify-center rounded-full border-2 border-background ${
                  u.is_owner ? "bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-400" : "bg-accent"
                }`}
              >
                <PlatformIcon platform={u.platform} className="size-3.5" />
              </div>
            ))}
            {onlineUsers.length > 5 && (
              <div className="flex size-7 items-center justify-center rounded-full bg-muted border-2 border-background text-[10px] font-medium">
                +{onlineUsers.length - 5}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <MessageCircle className="size-12 opacity-30 mb-3" />
            <p className="text-sm">{t("room.noMessages")}</p>
          </div>
        )}
        {messages.map((msg) => {
          const isSystem = msg.sender_type === "system";
          const isAgent = msg.sender_type === "agent";
          const isMe = msg.sender_type === "user" && msg.sender_name === effectiveNickname;

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm ${
                isAgent
                  ? "bg-primary/15 text-primary"
                  : "bg-accent"
              }`}>
                {isAgent ? (
                  <Bot className="size-4" />
                ) : (
                  <PlatformIcon platform={msg.platform || "web"} className="size-4" />
                )}
              </div>
              <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                  <span className={`text-xs font-medium ${isAgent ? "text-primary" : "text-foreground"}`}>
                    {isMe ? t("room.you") : msg.sender_name}
                  </span>
                  {msg.platform && !isAgent && (
                    <span className="text-[10px] text-muted-foreground capitalize">{msg.platform}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word ${
                  isAgent
                    ? "bg-primary/10 text-foreground rounded-tl-sm"
                    : isMe
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-accent text-foreground rounded-tl-sm"
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-card px-4 py-3 shrink-0">
        {room?.status === "closed" ? (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
            <Lock className="size-4" />
            <span className="text-sm">{t("room.closed")}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <PlatformIcon platform={identity?.platform || "web"} className="size-3.5 text-muted-foreground" />
              {identity?.is_owner && (
                <ShieldCheck className="size-3 text-amber-500" />
              )}
              {agentName && (
                <button
                  type="button"
                  onClick={() => {
                    const mention = `@${agentName} `;
                    if (!inputText.includes(`@${agentName}`)) {
                      setInputText((prev) => mention + prev);
                    }
                    inputRef.current?.focus();
                  }}
                  className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 px-1.5 py-0.5 rounded-md transition-colors"
                  title={t("room.mentionAgent", { name: agentName })}
                >
                  <Bot className="size-3" />
                  <span className="max-w-[60px] truncate">@{agentName}</span>
                </button>
              )}
            </div>
            <Input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("room.messagePlaceholder", { name: agentName || "Agent" })}
              className="flex-1"
              disabled={sending}
              autoFocus
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
