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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, ChevronDown, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Skill, Agent } from "@/types/database";

const EMPTY_FORM = {
  name: "",
  description: "",
  content: "",
  source_url: "",
};

export default function SkillsPage() {
  const t = useT();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "url">("manual");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<Skill | null>(null);
  const [boundAgentIds, setBoundAgentIds] = useState<string[]>([]);
  const [bindSaving, setBindSaving] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/skills");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSkills(data.skills ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("skills.loadFailed")
      );
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
    fetchSkills();
    fetchAgents();
  }, [fetchSkills, fetchAgents]);

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
      toast.error(t("skills.nameRequired"));
      return;
    }
    if (!editing && createMode === "manual" && !form.content.trim()) {
      toast.error(t("skills.contentRequired"));
      return;
    }
    if (!editing && createMode === "url" && !form.source_url.trim()) {
      toast.error(t("skills.urlRequired"));
      return;
    }

    setSaving(true);
    try {
      const payload = editing
        ? {
          id: editing.id,
          name: form.name,
          description: form.description,
          content: form.content,
        }
        : createMode === "url"
          ? {
            name: form.name,
            description: form.description,
            source_url: form.source_url,
          }
          : {
            name: form.name,
            description: form.description,
            content: form.content,
          };

      const res = await fetch("/api/admin/skills", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(
        editing ? t("skills.skillUpdated") : t("skills.skillCreated")
      );
      setDialogOpen(false);
      fetchSkills();
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
      const res = await fetch(`/api/admin/skills?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("mcp.deleted"));
      setDeleteTarget(null);
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
    } finally {
      setDeleting(null);
    }
  };

  // ── Bind Agents ──
  const openBind = async (skill: Skill) => {
    setBindTarget(skill);
    setBoundAgentIds([]);
    setBindDialogOpen(true);
    try {
      const res = await fetch(
        `/api/admin/agents/skills?skill_id=${skill.id}`
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
      const res = await fetch("/api/admin/agents/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill_id: bindTarget.id,
          agent_ids: boundAgentIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("skills.bindUpdated"));
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
            {t("skills.title")}
          </h1>
          <p className="text-muted-foreground">{t("skills.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchSkills();
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("common.refresh")}
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-2 size-4" />
            {t("skills.addSkill")}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editing
                    ? t("skills.editSkill")
                    : t("skills.addSkillTitle")}
                </DialogTitle>
              </DialogHeader>

              {!editing && (
                <Tabs
                  value={createMode}
                  onValueChange={(v) =>
                    setCreateMode(v as "manual" | "url")
                  }
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="manual" className="flex-1">
                      {t("skills.manual")}
                    </TabsTrigger>
                    <TabsTrigger value="url" className="flex-1">
                      {t("skills.importUrl")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="manual">
                    <div className="grid gap-4 pt-2">
                      <div>
                        <Label>{t("skills.name")}</Label>
                        <Input
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                          placeholder={t("skills.namePlaceholder")}
                        />
                      </div>
                      <div>
                        <Label>{t("skills.description")}</Label>
                        <Input
                          value={form.description}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                          placeholder={t("skills.descPlaceholder")}
                        />
                      </div>
                      <div>
                        <Label>{t("skills.content")}</Label>
                        <Textarea
                          value={form.content}
                          onChange={(e) =>
                            setForm({ ...form, content: e.target.value })
                          }
                          rows={12}
                          className="max-h-80 resize-y font-mono text-sm"
                          placeholder={t("skills.contentPlaceholder")}
                        />
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="url">
                    <div className="grid gap-4 pt-2">
                      <div>
                        <Label>{t("skills.name")}</Label>
                        <Input
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                          placeholder={t("skills.namePlaceholder")}
                        />
                      </div>
                      <div>
                        <Label>{t("skills.description")}</Label>
                        <Input
                          value={form.description}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                          placeholder={t("skills.descPlaceholder")}
                        />
                      </div>
                      <div>
                        <Label>{t("skills.sourceUrl")}</Label>
                        <Input
                          value={form.source_url}
                          onChange={(e) =>
                            setForm({ ...form, source_url: e.target.value })
                          }
                          placeholder={t("skills.sourceUrlPlaceholder")}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("skills.sourceUrlHint")}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              {editing && (
                <div className="grid gap-4 py-4">
                  <div>
                    <Label>{t("skills.name")}</Label>
                    <Input
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("skills.description")}</Label>
                    <Input
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("skills.content")}</Label>
                    <Textarea
                      value={form.content}
                      onChange={(e) =>
                        setForm({ ...form, content: e.target.value })
                      }
                      rows={12}
                      className="max-h-80 resize-y font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
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
          <CardTitle>{t("skills.installedSkills")}</CardTitle>
          <CardDescription>{t("skills.installedSkillsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("skills.noSkills")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t("skills.name")}</TableHead>
                  <TableHead>{t("skills.description")}</TableHead>
                  <TableHead>{t("skills.source")}</TableHead>
                  <TableHead>{t("common.created")}</TableHead>
                  <TableHead className="text-right">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((s) => {
                  const isOpen = expandedId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpandedId(isOpen ? null : s.id)
                        }
                      >
                        <TableCell>
                          <ChevronDown
                            className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {s.name}
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-sm text-muted-foreground">
                          {s.description || "\u2014"}
                        </TableCell>
                        <TableCell>
                          {s.source_url ? (
                            <Badge variant="outline">URL</Badge>
                          ) : (
                            <Badge variant="secondary">
                              {t("skills.manual")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(s.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="flex justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openBind(s)}
                              title={t("skills.bindAgents")}
                            >
                              <Link2 className="size-4" />
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
                      {isOpen && (
                        <tr>
                          <td
                            colSpan={6}
                            className="border-b bg-muted/50 p-4"
                          >
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

      {/* Bind Agents Dialog */}
      <Dialog open={bindDialogOpen} onOpenChange={setBindDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("skills.bindAgents")} — {bindTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("skills.bindAgentsDesc")}
          </p>
          <div className="flex flex-col gap-2 py-4">
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("skills.noAgentsAvailable")}
              </p>
            ) : (
              agents.map((a) => {
                const selected = boundAgentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${selected
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
            <Button variant="ghost" onClick={() => setBindDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
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
        description={t("skills.deleteConfirm", {
          name: deleteTarget?.name || "",
        })}
        confirmText={t("common.delete")}
        loading={!!deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
