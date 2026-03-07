"use client";

import React, { useState, useEffect, useCallback } from "react";
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
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import type { Skill } from "@/types/database";

const EMPTY_FORM = {
  name: "",
  description: "",
  content: "",
  source_url: "",
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "url">("manual");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/skills");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSkills(data.skills ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreateMode("manual");
    setDialogOpen(true);
  };

  const openEdit = (s: Skill) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description,
      content: s.content,
      source_url: s.source_url || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!editing && createMode === "manual" && !form.content.trim()) {
      toast.error("Content is required");
      return;
    }
    if (!editing && createMode === "url" && !form.source_url.trim()) {
      toast.error("URL is required");
      return;
    }

    setSaving(true);
    try {
      const payload = editing
        ? { id: editing.id, name: form.name, description: form.description, content: form.content }
        : createMode === "url"
          ? { name: form.name, description: form.description, source_url: form.source_url }
          : { name: form.name, description: form.description, content: form.content };

      const res = await fetch("/api/admin/skills", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(editing ? "Skill updated" : "Skill created");
      setDialogOpen(false);
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete skill "${name}"? This will unbind it from all agents.`)) return;
    try {
      const res = await fetch(`/api/admin/skills?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Deleted");
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground">
            Manage knowledge and behavior skills for your agents
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setLoading(true); fetchSkills(); }}
          >
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-2 size-4" />
            Add Skill
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit Skill" : "Add Skill"}
                </DialogTitle>
              </DialogHeader>

              {!editing && (
                <Tabs
                  value={createMode}
                  onValueChange={(v) => setCreateMode(v as "manual" | "url")}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
                    <TabsTrigger value="url" className="flex-1">Import from URL</TabsTrigger>
                  </TabsList>
                  <TabsContent value="manual">
                    <div className="grid gap-4 pt-2">
                      <div>
                        <Label>Name</Label>
                        <Input
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="e.g. code-review-expert"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="What this skill teaches the agent"
                        />
                      </div>
                      <div>
                        <Label>Content (Markdown)</Label>
                        <Textarea
                          value={form.content}
                          onChange={(e) => setForm({ ...form, content: e.target.value })}
                          rows={12}
                          className="max-h-80 resize-y font-mono text-sm"
                          placeholder="# Skill Instructions&#10;&#10;You are an expert at..."
                        />
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="url">
                    <div className="grid gap-4 pt-2">
                      <div>
                        <Label>Name</Label>
                        <Input
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="e.g. code-review-expert"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="What this skill teaches the agent"
                        />
                      </div>
                      <div>
                        <Label>Source URL</Label>
                        <Input
                          value={form.source_url}
                          onChange={(e) => setForm({ ...form, source_url: e.target.value })}
                          placeholder="https://raw.githubusercontent.com/.../SKILL.md"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          The server will fetch the Markdown content from this URL.
                          Works with GitHub raw links, Gist raw URLs, etc.
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              {editing && (
                <div className="grid gap-4 py-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Content (Markdown)</Label>
                    <Textarea
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      rows={12}
                      className="max-h-80 resize-y font-mono text-sm"
                    />
                  </div>
                </div>
              )}

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
          <CardTitle>Installed Skills</CardTitle>
          <CardDescription>
            Skills are injected into the agent&apos;s system prompt. Bind skills
            to agents on the Agents page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills installed. Click &quot;Add Skill&quot; to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((s) => {
                  const isOpen = expandedId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedId(isOpen ? null : s.id)}
                      >
                        <TableCell>
                          <ChevronDown
                            className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="max-w-[250px] truncate text-sm text-muted-foreground">
                          {s.description || "—"}
                        </TableCell>
                        <TableCell>
                          {s.source_url ? (
                            <Badge variant="outline">URL</Badge>
                          ) : (
                            <Badge variant="secondary">Manual</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(s.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id, s.name)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="border-b bg-muted/50 p-4">
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs">
                              {s.content}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
