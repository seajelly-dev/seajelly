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
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Zap, RefreshCw } from "lucide-react";
import type { McpServer } from "@/types/database";

const EMPTY_FORM = {
  name: "",
  url: "",
  transport: "http" as "http" | "sse",
  headers: "{}",
  enabled: true,
};

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mcp");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setServers(data.servers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

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
      toast.error("Name and URL are required");
      return;
    }

    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(form.headers);
    } catch {
      toast.error("Headers must be valid JSON");
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

      toast.success(editing ? "Server updated" : "Server added");
      setDialogOpen(false);
      fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/mcp?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Deleted");
      fetchServers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
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
          `Connected! ${data.tools?.length || 0} tools: ${(data.tools || []).join(", ") || "none"}`
        );
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Servers</h1>
          <p className="text-muted-foreground">
            Manage Model Context Protocol server connections
          </p>
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
            Refresh
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button size="sm" onClick={openNew} />}>
              <Plus className="mr-2 size-4" />
              Add Server
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit MCP Server" : "Add MCP Server"}
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground rounded-md bg-muted p-3">
                Only remote MCP servers with an HTTP or SSE endpoint are
                supported. Local stdio-based servers (e.g.{" "}
                <code className="text-[11px]">npx @upstash/context7-mcp</code>)
                cannot run in serverless environments. Look for a hosted/cloud
                version of the MCP server you want to use.
              </p>
              <div className="grid gap-4 py-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="e.g. Context7"
                  />
                </div>
                <div>
                  <Label>URL</Label>
                  <Input
                    value={form.url}
                    onChange={(e) =>
                      setForm({ ...form, url: e.target.value })
                    }
                    placeholder="https://mcp.context7.com/mcp"
                  />
                </div>
                <div>
                  <Label>Transport</Label>
                  <Select
                    value={form.transport}
                    onValueChange={(v) =>
                      setForm({ ...form, transport: v as "http" | "sse" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">
                        Streamable HTTP
                      </SelectItem>
                      <SelectItem value="sse">SSE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Headers (JSON)</Label>
                  <Textarea
                    value={form.headers}
                    onChange={(e) =>
                      setForm({ ...form, headers: e.target.value })
                    }
                    rows={3}
                    placeholder='{"Authorization": "Bearer ..."}'
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered Servers</CardTitle>
          <CardDescription>
            MCP servers can be bound to individual agents. Use &quot;Test&quot; to verify
            connectivity and list available tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No MCP servers configured. Click &quot;Add Server&quot; to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                      <Badge variant="outline">{s.transport.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? "Enabled" : "Disabled"}
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
                          disabled={testing === s.id}
                          onClick={() => handleTest(s)}
                          title="Test Connection"
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
    </div>
  );
}
