"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ChannelRow {
  id: string;
  agent_id: string;
  platform: string;
  platform_uid: string;
  display_name: string | null;
  user_soul: string;
  is_allowed: boolean;
  created_at: string;
  updated_at: string;
  agents: { name: string } | null;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [soulDialog, setSoulDialog] = useState<ChannelRow | null>(null);
  const [soulText, setSoulText] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/channels");
      const data = await res.json();
      setChannels(data.channels ?? []);
    } catch {
      toast.error("Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const toggleAllowed = async (ch: ChannelRow) => {
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id, is_allowed: !ch.is_allowed }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(ch.is_allowed ? "Channel blocked" : "Channel allowed");
      fetchChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const openSoul = (ch: ChannelRow) => {
    setSoulDialog(ch);
    setSoulText(ch.user_soul || "");
  };

  const saveSoul = async () => {
    if (!soulDialog) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: soulDialog.id, user_soul: soulText }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Soul updated");
      setSoulDialog(null);
      fetchChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async (ch: ChannelRow) => {
    if (!confirm(`Delete channel ${ch.display_name || ch.platform_uid}?`))
      return;
    try {
      const res = await fetch(`/api/admin/channels?id=${ch.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Channel deleted");
      fetchChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-muted-foreground">
          Manage platform users, access control, and soul profiles
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <p className="text-muted-foreground">
              No channels yet. Channels are created automatically when users
              message your bot.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((ch) => (
            <Card key={ch.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {ch.display_name || "Unknown"}
                      <Badge
                        variant={ch.is_allowed ? "secondary" : "destructive"}
                      >
                        {ch.is_allowed ? "Allowed" : "Blocked"}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">
                      {ch.platform}:{ch.platform_uid}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Agent:</span>{" "}
                  {ch.agents?.name ?? "N/A"}
                </div>

                {ch.user_soul ? (
                  <div className="rounded-md bg-muted p-2 text-xs">
                    <span className="font-medium">User Soul: </span>
                    <span className="text-muted-foreground">
                      {ch.user_soul.length > 120
                        ? ch.user_soul.slice(0, 120) + "..."
                        : ch.user_soul}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    No user soul profile yet
                  </div>
                )}

                <div className="flex gap-1 pt-1">
                  <Button
                    variant={ch.is_allowed ? "destructive" : "default"}
                    size="sm"
                    onClick={() => toggleAllowed(ch)}
                  >
                    {ch.is_allowed ? "Block" : "Allow"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openSoul(ch)}
                  >
                    Edit Soul
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteChannel(ch)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!soulDialog}
        onOpenChange={(open) => !open && setSoulDialog(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit Soul — {soulDialog?.display_name || soulDialog?.platform_uid}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label>Soul Profile</Label>
              <Textarea
                rows={10}
                value={soulText}
                onChange={(e) => setSoulText(e.target.value)}
                placeholder={
                  "Name: 李荣鑫\nPreferred address: 老李\nPersonality: humorous, tech-savvy\nLanguage: Chinese"
                }
              />
              <p className="text-xs text-muted-foreground">
                The soul is injected into the system prompt for every
                conversation with this user. The AI can also update it via the
                soul_update tool.
              </p>
            </div>
            <Button onClick={saveSoul} disabled={saving}>
              {saving ? "Saving..." : "Save Soul"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
