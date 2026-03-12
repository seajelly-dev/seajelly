"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  Monitor,
  MessageCircle,
  Lock,
  Loader2,
} from "lucide-react";
import type { ChatRoom, ChatRoomMessage } from "@/types/database";

const PLATFORM_ICONS: Record<string, string> = {
  telegram: "🔵",
  feishu: "🟣",
  wecom: "🟢",
  slack: "🟠",
  qqbot: "🔴",
  web: "🌐",
};

const PLATFORM_OPTIONS = [
  { value: "web", label: "Web" },
  { value: "telegram", label: "Telegram" },
  { value: "feishu", label: "Feishu" },
  { value: "wecom", label: "WeCom" },
  { value: "slack", label: "Slack" },
  { value: "qqbot", label: "QQ Bot" },
];

interface JoinForm {
  nickname: string;
  platform: string;
}

interface PresenceUser {
  nickname: string;
  platform: string;
  joined_at: string;
}

export default function ChatRoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [messages, setMessages] = useState<ChatRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinForm, setJoinForm] = useState<JoinForm>({ nickname: "", platform: "web" });
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("chatroom_user");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.nickname) {
          setJoinForm(parsed);
          setJoined(true);
        }
      } catch { /* ignore */ }
    }
  }, []);

  const fetchRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/app/room?id=${roomId}`);
      const data = await res.json();
      if (!res.ok || !data.room) {
        setNotFound(true);
        return;
      }
      setRoom(data.room);
      setMessages(data.messages ?? []);
      if (data.agent) setAgentName(data.agent.name);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  useEffect(() => {
    if (!room || !joined) return;

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
          if (newMsg.sender_type === "system" && newMsg.content.includes("closed")) {
            setRoom((r) => r ? { ...r, status: "closed" } : r);
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
            nickname: joinForm.nickname,
            platform: joinForm.platform,
            joined_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, joined, roomId, joinForm.nickname, joinForm.platform]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleJoin = () => {
    if (!joinForm.nickname.trim()) return;
    localStorage.setItem("chatroom_user", JSON.stringify(joinForm));
    setJoined(true);
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
          sender_name: joinForm.nickname,
          platform: joinForm.platform,
          content: text,
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

  if (notFound) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <MessageCircle className="size-16 text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Room Not Found</h2>
            <p className="text-muted-foreground">This chatroom does not exist or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="max-w-sm w-full mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <MessageCircle className="size-7 text-primary" />
              </div>
            </div>
            <CardTitle className="text-xl">Join Chatroom</CardTitle>
            {room?.title && (
              <p className="text-sm text-muted-foreground mt-1">{room.title}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Nickname</label>
              <Input
                value={joinForm.nickname}
                onChange={(e) => setJoinForm((f) => ({ ...f, nickname: e.target.value }))}
                placeholder="Enter your nickname"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Platform</label>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORM_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setJoinForm((f) => ({ ...f, platform: opt.value }))}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-colors ${
                      joinForm.platform === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <span>{PLATFORM_ICONS[opt.value]}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={handleJoin}
              disabled={!joinForm.nickname.trim()}
            >
              Join
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
              {room?.title || "Chatroom"}
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
                  <Lock className="size-3" /> Closed
                </span>
              ) : (
                <span className="text-green-500">Active</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="gap-1 text-xs">
            <Users className="size-3" />
            {onlineUsers.length}
          </Badge>
          <div className="flex -space-x-1">
            {onlineUsers.slice(0, 5).map((u, i) => (
              <div
                key={`${u.nickname}-${i}`}
                title={`${u.nickname} (${u.platform})`}
                className="flex size-7 items-center justify-center rounded-full bg-accent border-2 border-background text-xs font-medium"
              >
                {PLATFORM_ICONS[u.platform] || "🌐"}
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
            <p className="text-sm">No messages yet. Say hi!</p>
          </div>
        )}
        {messages.map((msg) => {
          const isSystem = msg.sender_type === "system";
          const isAgent = msg.sender_type === "agent";
          const isMe = msg.sender_type === "user" && msg.sender_name === joinForm.nickname;

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
                  <span>{PLATFORM_ICONS[msg.platform || "web"] || "🌐"}</span>
                )}
              </div>
              <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                  <span className={`text-xs font-medium ${isAgent ? "text-primary" : "text-foreground"}`}>
                    {msg.sender_name}
                  </span>
                  {msg.platform && !isAgent && (
                    <span className="text-[10px] text-muted-foreground">{msg.platform}</span>
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
            <span className="text-sm">This chatroom has been closed</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              <Monitor className="size-3.5" />
              <span className="hidden sm:inline">{joinForm.nickname}</span>
            </div>
            <Input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (@agent to call AI)"
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
