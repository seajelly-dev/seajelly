"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Zap, RefreshCw, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { McpServer, Agent } from "@/types/database";

const EMPTY_FORM = {
  name: "",
  url: "",
  transport: "http" as "http" | "sse",
  headers: "{}",
  enabled: true,
};

export default function McpPage() {
  const t = useT();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<McpServer | null>(null);
  const [boundAgentIds, setBoundAgentIds] = useState<string[]>([]);
  const [bindSaving, setBindSaving] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mcp");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setServers(data.servers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mcp.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      if (res.ok) setAgents(data.agents ?? []);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    fetchServers();
    fetchAgents();
  }, [fetchServers, fetchAgents]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (s: McpServer) => {
    setEditing(s);
    setForm({
      name: s.name,
      url: s.url,
      transport: s.transport,
      headers: JSON.stringify(s.headers || {}, null, 2),
      enabled: s.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error(t("mcp.nameUrlRequired"));
      return;
    }

    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(form.headers);
    } catch {
      toast.error(t("mcp.headersInvalid"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        url: form.url,
        transport: form.transport,
        headers,
        enabled: form.enabled,
      };

      const res = await fetch("/api/admin/mcp", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(editing ? t("mcp.serverUpdated") : t("mcp.serverAdded"));
      setDialogOpen(false);
      fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.saving"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      const res = await fetch(`/api/admin/mcp?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("mcp.deleted"));
      setDeleteTarget(null);
      fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    } finally {
      setDeleting(null);
    }
  };

  const handleTest = async (server: McpServer) => {
    setTesting(server.id);
    try {
      const res = await fetch("/api/admin/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: server.url,
          transport: server.transport,
          headers: server.headers,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          t("mcp.testConnected", {
            count: data.tools?.length || 0,
            tools: (data.tools || []).join(", ") || "none",
          })
        );
      } else {
        toast.error(t("mcp.testFailed", { error: data.error }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mcp.loadFailed"));
    } finally {
      setTesting(null);
    }
  };

  // ── Bind Agents ──
  const openBind = async (server: McpServer) => {
    setBindTarget(server);
    setBoundAgentIds([]);
    setBindDialogOpen(true);
    try {
      const res = await fetch(
        `/api/admin/agents/mcps?mcp_server_id=${server.id}`
      );
      const data = await res.json();
      if (res.ok) setBoundAgentIds(data.agent_ids ?? []);
    } catch {
      /* non-critical */
    }
  };

  const toggleAgent = (agentId: string) => {
    setBoundAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleBindSave = async () => {
    if (!bindTarget) return;
    setBindSaving(true);
    try {
      const res = await fetch("/api/admin/agents/mcps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp_server_id: bindTarget.id,
          agent_ids: boundAgentIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("mcp.bindUpdated"));
      setBindDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.saving"));
    } finally {
      setBindSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("mcp.title")}
          </h1>
          <p className="text-muted-foreground">{t("mcp.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchServers();
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("common.refresh")}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              id="mcp-add-dialog-trigger"
              render={<Button size="sm" onClick={openNew} />}
            >
              <Plus className="mr-2 size-4" />
              {t("mcp.addServer")}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? t("mcp.editServer") : t("mcp.addServerTitle")}
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground rounded-md bg-muted p-3">
                {t("mcp.serverNote")}
              </p>
              <div className="grid gap-4 py-4">
                <div>
                  <Label>{t("mcp.name")}</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder={t("mcp.namePlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("mcp.url")}</Label>
                  <Input
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder={t("mcp.urlPlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("mcp.transport")}</Label>
                  <Select
                    value={form.transport}
                    onValueChange={(v) =>
                      setForm({ ...form, transport: v as "http" | "sse" })
                    }
                  >
                    <SelectTrigger id="mcp-transport-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">
                        {t("mcp.streamableHttp")}
                      </SelectItem>
                      <SelectItem value="sse">SSE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("mcp.headers")}</Label>
                  <Textarea
                    value={form.headers}
                    onChange={(e) =>
                      setForm({ ...form, headers: e.target.value })
                    }
                    rows={3}
                    placeholder={t("mcp.headersPlaceholder")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("mcp.registeredServers")}</CardTitle>
          <CardDescription>{t("mcp.registeredServersDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("mcp.noServers")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("mcp.name")}</TableHead>
                  <TableHead>{t("mcp.url")}</TableHead>
                  <TableHead>{t("mcp.transport")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.created")}</TableHead>
                  <TableHead className="text-right">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="max-w-[250px] truncate font-mono text-sm">
                      {s.url}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {s.transport.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? t("common.enabled") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openBind(s)}
                          title={t("mcp.bindAgents")}
                        >
                          <Link2 className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={testing === s.id}
                          onClick={() => handleTest(s)}
                        >
                          <Zap className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(s)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleting === s.id}
                          onClick={() => handleDelete(s.id, s.name)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bind Agents Dialog */}
      <Dialog open={bindDialogOpen} onOpenChange={setBindDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mcp.bindAgents")} — {bindTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("mcp.bindAgentsDesc")}
          </p>
          <div className="flex flex-col gap-2 py-4">
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("mcp.noAgentsAvailable")}
              </p>
            ) : (
              agents.map((a) => {
                const selected = boundAgentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {a.model}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleBindSave} disabled={bindSaving}>
              {bindSaving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("common.delete")}
        description={t("mcp.deleteConfirm", {
          name: deleteTarget?.name || "",
        })}
        loading={!!deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
