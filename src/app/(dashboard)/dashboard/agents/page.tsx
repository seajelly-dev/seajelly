"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Agent } from "@/types/database";
import { getAvailableModels, MODEL_CATALOG, type ModelDef } from "@/lib/models";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    name: "",
    system_prompt: "",
    model: "",
  });
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelDef[]>(MODEL_CATALOG);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      toast.error("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/secrets");
      const data = await res.json();
      const keyNames = new Set((data.secrets ?? []).map((s: { key_name: string }) => s.key_name));
      const models = getAvailableModels(keyNames as Set<string>);
      setAvailableModels(models.length > 0 ? models : MODEL_CATALOG);
    } catch {
      // fallback to full catalog
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchModels();
  }, [fetchAgents, fetchModels]);

  const openCreate = () => {
    setEditingAgent(null);
    setForm({ name: "", system_prompt: "", model: availableModels[0]?.id ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      model: agent.model,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Agent name is required");
      return;
    }
    setSaving(true);
    try {
      const method = editingAgent ? "PUT" : "POST";
      const payload = editingAgent ? { id: editingAgent.id, ...form } : form;
      const res = await fetch("/api/admin/agents", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(editingAgent ? "Agent updated" : "Agent created");
      setDialogOpen(false);
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/agents?id=${agent.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Agent deleted");
      fetchAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">
            Configure AI agent personas and models
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button onClick={openCreate} />}>
            New Agent
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingAgent ? "Edit Agent" : "Create Agent"}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="My Agent"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Model</Label>
                <Select
                  value={form.model}
                  onValueChange={(v) => setForm((f) => ({ ...f, model: v ?? f.model }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {m.provider}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>System Prompt</Label>
                <Textarea
                  rows={8}
                  value={form.system_prompt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, system_prompt: e.target.value }))
                  }
                  placeholder="You are a helpful AI assistant..."
                />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <p className="text-muted-foreground">No agents yet.</p>
            <Button onClick={openCreate}>Create your first agent</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {agent.name}
                      {agent.is_default && (
                        <Badge variant="secondary">Default</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {agent.model}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(agent)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(agent)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {agent.system_prompt || "No system prompt set"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
