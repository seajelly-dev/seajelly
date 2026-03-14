"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  RefreshCw,
  Plus,
  Trash2,
  HardDrive,
  FileIcon,
  ExternalLink,
  Pencil,
  Zap,
  Copy,
  Search,
  Info,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";

interface StorageRow {
  id: string;
  name: string;
  account_id: string;
  bucket_name: string;
  endpoint: string;
  public_url: string;
  is_active_write: boolean;
  max_bytes: number;
  created_at: string;
  updated_at: string;
  file_count: number;
  used_bytes: number;
}

interface FileRow {
  id: string;
  storage_id: string;
  original_name: string;
  mime_type: string | null;
  file_size: number;
  public_url: string;
  created_at: string;
  jellybox_storages: { name: string } | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
      <Info className="size-3 mt-0.5 shrink-0 opacity-60" />
      <span>{children}</span>
    </p>
  );
}

export default function JellyBoxPage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"storages" | "files">("storages");
  const [storages, setStorages] = useState<StorageRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [filePage, setFilePage] = useState(1);
  const [fileTotal, setFileTotal] = useState(0);
  const [fileSearch, setFileSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; type: "storage" | "file" } | null>(null);
  const [testing, setTesting] = useState(false);

  const [form, setForm] = useState({
    name: "",
    account_id: "",
    bucket_name: "",
    endpoint: "",
    public_url: "",
    access_key_id: "",
    secret_access_key: "",
    max_bytes_gb: "10",
    is_active_write: false,
  });

  const loadStorages = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/jellybox");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStorages(data.storages ?? []);
    } catch {
      toast.error(t("jellybox.loadFailed"));
    }
  }, [t]);

  const loadFiles = useCallback(async (page = 1, search = "") => {
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/jellybox/files?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFiles(data.files ?? []);
      setFileTotal(data.total ?? 0);
      setFilePage(page);
    } catch {
      toast.error(t("jellybox.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStorages(), loadFiles()]).finally(() => setLoading(false));
  }, [loadStorages, loadFiles]);

  function resetForm() {
    setForm({
      name: "", account_id: "", bucket_name: "", endpoint: "",
      public_url: "", access_key_id: "", secret_access_key: "",
      max_bytes_gb: "10", is_active_write: false,
    });
    setEditId(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(s: StorageRow) {
    setForm({
      name: s.name,
      account_id: s.account_id,
      bucket_name: s.bucket_name,
      endpoint: s.endpoint,
      public_url: s.public_url,
      access_key_id: "",
      secret_access_key: "",
      max_bytes_gb: String(Math.round(s.max_bytes / (1024 * 1024 * 1024))),
      is_active_write: s.is_active_write,
    });
    setEditId(s.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name || !form.account_id || !form.bucket_name || !form.endpoint || !form.public_url) {
      toast.error(t("jellybox.fieldsRequired"));
      return;
    }
    if (!editId && (!form.access_key_id || !form.secret_access_key)) {
      toast.error(t("jellybox.fieldsRequired"));
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name,
      account_id: form.account_id,
      bucket_name: form.bucket_name,
      endpoint: form.endpoint,
      public_url: form.public_url,
      is_active_write: form.is_active_write,
      max_bytes: Math.round(parseFloat(form.max_bytes_gb) * 1024 * 1024 * 1024),
    };
    if (editId) payload.id = editId;
    if (form.access_key_id) payload.access_key_id = form.access_key_id;
    if (form.secret_access_key) payload.secret_access_key = form.secret_access_key;

    const res = await fetch("/api/admin/jellybox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed");
      return;
    }

    toast.success(editId ? t("jellybox.storageUpdated") : t("jellybox.storageCreated"));
    setShowForm(false);
    resetForm();
    await loadStorages();
  }

  async function handleTest() {
    if (!form.endpoint || !form.bucket_name) {
      toast.error(t("jellybox.fieldsRequired"));
      return;
    }
    if (!form.access_key_id || !form.secret_access_key) {
      toast.error(t("jellybox.fieldsRequired"));
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/jellybox/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: form.endpoint,
          access_key_id: form.access_key_id,
          secret_access_key: form.secret_access_key,
          bucket_name: form.bucket_name,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(t("jellybox.testSuccess"));
      } else {
        toast.error(t("jellybox.testFailed", { error: data.error || "Unknown" }));
      }
    } catch {
      toast.error(t("jellybox.testFailed", { error: "Network error" }));
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const { id, type } = confirmDelete;
    const url = type === "storage"
      ? `/api/admin/jellybox?id=${id}`
      : `/api/admin/jellybox/files?id=${id}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success(type === "storage" ? t("jellybox.storageDeleted") : t("jellybox.fileDeleted"));
    setConfirmDelete(null);
    if (type === "storage") await loadStorages();
    else await loadFiles(filePage, fileSearch);
  }

  const totalUsed = storages.reduce((s, r) => s + r.used_bytes, 0);
  const totalMax = storages.reduce((s, r) => s + r.max_bytes, 0);
  const totalFiles = storages.reduce((s, r) => s + r.file_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("jellybox.title")}</h1>
          <p className="text-muted-foreground">{t("jellybox.subtitle")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => { loadStorages(); loadFiles(1, fileSearch); }}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {storages.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("jellybox.usageTitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatBytes(totalUsed)}</div>
              <p className="text-xs text-muted-foreground">{t("jellybox.usageCapacity", { used: formatBytes(totalUsed), max: formatBytes(totalMax) })}</p>
              <Progress value={totalMax > 0 ? (totalUsed / totalMax) * 100 : 0} className="mt-2 h-2" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("jellybox.files")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalFiles}</div>
              <p className="text-xs text-muted-foreground">{t("jellybox.usageFiles", { count: String(totalFiles) })}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("jellybox.tabs.storages")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{storages.length}</div>
              <p className="text-xs text-muted-foreground">
                {storages.filter((s) => s.is_active_write).length > 0
                  ? `Active: ${storages.find((s) => s.is_active_write)?.name}`
                  : "No active storage"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pill-style tab switcher (same as /dashboard/coding) */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setActiveTab("storages")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "storages"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <HardDrive className="size-4 inline-block mr-1.5 -mt-0.5" />
          {t("jellybox.tabs.storages")}
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "files"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileIcon className="size-4 inline-block mr-1.5 -mt-0.5" />
          {t("jellybox.tabs.files")}
        </button>
      </div>

      {/* ── Storages Tab ── */}
      {activeTab === "storages" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4 mr-1.5" />
              {t("jellybox.addStorage")}
            </Button>
          </div>

          {storages.length === 0 && !loading ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <HardDrive className="mx-auto mb-3 size-10 opacity-40" />
                <p>{t("jellybox.noStorages")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {storages.map((s) => {
                const pct = s.max_bytes > 0 ? (s.used_bytes / s.max_bytes) * 100 : 0;
                return (
                  <Card key={s.id}>
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{s.name}</span>
                          {s.is_active_write && (
                            <Badge variant="default" className="text-xs">
                              <Zap className="size-3 mr-0.5" />
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {s.bucket_name} · {s.file_count} files · {formatBytes(s.used_bytes)} / {formatBytes(s.max_bytes)}
                        </p>
                        <Progress value={pct} className="h-1.5 max-w-xs" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDelete({ id: s.id, name: s.name, type: "storage" })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Files Tab ── */}
      {activeTab === "files" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("jellybox.filesDesc")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("jellybox.fileName") + "..."}
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadFiles(1, fileSearch); }}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => loadFiles(1, fileSearch)}>
                <Search className="size-4" />
              </Button>
            </div>

            {files.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <FileIcon className="mx-auto mb-3 size-10 opacity-40" />
                <p>{t("jellybox.noFiles")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">{t("jellybox.fileName")}</th>
                      <th className="pb-2 font-medium">{t("jellybox.fileSize")}</th>
                      <th className="pb-2 font-medium">{t("jellybox.mimeType")}</th>
                      <th className="pb-2 font-medium">{t("jellybox.storage")}</th>
                      <th className="pb-2 font-medium">{t("common.created")}</th>
                      <th className="pb-2 font-medium">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} className="border-b last:border-0">
                        <td className="py-2 max-w-[200px] truncate">{f.original_name}</td>
                        <td className="py-2 whitespace-nowrap">{formatBytes(f.file_size)}</td>
                        <td className="py-2 text-muted-foreground">{f.mime_type || "—"}</td>
                        <td className="py-2">{f.jellybox_storages?.name || "—"}</td>
                        <td className="py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(f.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                navigator.clipboard.writeText(f.public_url);
                                toast.success(t("settings.copySuccess"));
                              }}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                            <a href={f.public_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="icon">
                                <ExternalLink className="size-3.5" />
                              </Button>
                            </a>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setConfirmDelete({ id: f.id, name: f.original_name, type: "file" })}
                            >
                              <Trash2 className="size-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {fileTotal > 20 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  {t("pagination.showing", {
                    from: String((filePage - 1) * 20 + 1),
                    to: String(Math.min(filePage * 20, fileTotal)),
                    total: String(fileTotal),
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filePage <= 1}
                    onClick={() => loadFiles(filePage - 1, fileSearch)}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filePage * 20 >= fileTotal}
                    onClick={() => loadFiles(filePage + 1, fileSearch)}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Storage Form Dialog (with integrated guide) ── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t("jellybox.editStorage") : t("jellybox.addStorage")}</DialogTitle>
            {!editId && (
              <p className="text-xs text-muted-foreground mt-1">{t("jellybox.guideIntro")}</p>
            )}
          </DialogHeader>
          <div className="space-y-4">
            {/* ① Bucket Name */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.bucketName")}</Label>
              <Input
                placeholder={t("jellybox.bucketNamePlaceholder")}
                value={form.bucket_name}
                onChange={(e) => setForm({ ...form, bucket_name: e.target.value })}
              />
              {!editId && <FieldHint>{t("jellybox.hintBucket")}</FieldHint>}
            </div>

            {/* ② Public URL */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.publicUrl")}</Label>
              <Input
                placeholder={t("jellybox.publicUrlPlaceholder")}
                value={form.public_url}
                onChange={(e) => setForm({ ...form, public_url: e.target.value })}
              />
              {!editId && <FieldHint>{t("jellybox.hintPublicUrl")}</FieldHint>}
            </div>

            {/* ③ CORS reminder */}
            {!editId && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium">{t("jellybox.corsTitle")}</p>
                <p>{t("jellybox.corsDesc")}</p>
              </div>
            )}

            {/* ④ Account ID */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.accountId")}</Label>
              <Input
                placeholder={t("jellybox.accountIdPlaceholder")}
                value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              />
              {!editId && <FieldHint>{t("jellybox.hintAccountId")}</FieldHint>}
            </div>

            {/* ⑤ S3 API Endpoint */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.endpoint")}</Label>
              <Input
                placeholder={t("jellybox.endpointPlaceholder")}
                value={form.endpoint}
                onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              />
              {!editId && <FieldHint>{t("jellybox.hintEndpoint")}</FieldHint>}
            </div>

            {/* ⑥ Access Key ID */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.accessKeyId")}</Label>
              <Input
                type="password"
                placeholder={editId ? t("jellybox.credentialKeepHint") : t("jellybox.accessKeyIdPlaceholder")}
                value={form.access_key_id}
                onChange={(e) => setForm({ ...form, access_key_id: e.target.value })}
              />
              {!editId && <FieldHint>{t("jellybox.hintApiToken")}</FieldHint>}
            </div>

            {/* ⑦ Secret Access Key */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.secretAccessKey")}</Label>
              <Input
                type="password"
                placeholder={editId ? t("jellybox.credentialKeepHint") : t("jellybox.secretAccessKeyPlaceholder")}
                value={form.secret_access_key}
                onChange={(e) => setForm({ ...form, secret_access_key: e.target.value })}
              />
              {editId && <FieldHint>{t("jellybox.credentialKeepHint")}</FieldHint>}
            </div>

            {/* Display Name */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.storageName")}</Label>
              <Input
                placeholder={t("jellybox.storageNamePlaceholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {/* Max Capacity */}
            <div className="space-y-1.5">
              <Label>{t("jellybox.maxBytes")}</Label>
              <Input
                type="number"
                min="1"
                value={form.max_bytes_gb}
                onChange={(e) => setForm({ ...form, max_bytes_gb: e.target.value })}
              />
            </div>

            {/* Active Write Toggle */}
            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active_write}
                onCheckedChange={(v) => setForm({ ...form, is_active_write: v })}
              />
              <div>
                <Label>{t("jellybox.isActiveWrite")}</Label>
                <p className="text-xs text-muted-foreground">{t("jellybox.isActiveWriteHint")}</p>
              </div>
            </div>

            {/* Last step hint */}
            {!editId && (
              <div className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                {t("jellybox.hintFinalStep")}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !form.access_key_id || !form.secret_access_key}
            >
              {testing ? t("jellybox.testing") : t("jellybox.testConnection")}
            </Button>
            <Button onClick={handleSave}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title={confirmDelete?.type === "storage" ? t("jellybox.deleteStorage") : t("jellybox.deleteFile")}
        description={
          confirmDelete?.type === "storage"
            ? t("jellybox.deleteStorageConfirm", { name: confirmDelete?.name ?? "" })
            : t("jellybox.deleteFileConfirm", { name: confirmDelete?.name ?? "" })
        }
        onConfirm={handleDelete}
        variant="destructive"
      />
    </div>
  );
}
