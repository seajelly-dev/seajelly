"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Key,
  Cpu,
  Layers,
  Globe,
  ChevronRight,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import type { Provider } from "@/types/database";
import { cn } from "@/lib/utils";

interface ProviderWithCounts extends Provider {
  model_count: number;
  key_count: number;
}

interface ApiKeyInfo {
  id: string;
  provider_id: string;
  label: string;
  is_active: boolean;
  call_count: number;
  created_at: string;
}

interface ModelInfo {
  id: string;
  model_id: string;
  label: string;
  provider_id: string;
  is_builtin: boolean;
  enabled: boolean;
}

export default function ModelsPage() {
  const t = useT();
  const [providers, setProviders] = useState<ProviderWithCounts[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({ name: "", base_url: "" });
  const [savingProvider, setSavingProvider] = useState(false);

  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [keyForm, setKeyForm] = useState({ api_key: "", label: "" });
  const [savingKey, setSavingKey] = useState(false);

  const [addModelOpen, setAddModelOpen] = useState(false);
  const [modelForm, setModelForm] = useState({ model_id: "", label: "" });
  const [savingModel, setSavingModel] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: "provider" | "key" | "model"; id: string; name: string } | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProviders(data.providers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchKeys = useCallback(async (providerId: string) => {
    try {
      const res = await fetch(`/api/admin/providers/keys?provider_id=${providerId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKeys(data.keys ?? []);
    } catch {
      setKeys([]);
    }
  }, []);

  const fetchModels = useCallback(async (providerId: string) => {
    try {
      const res = await fetch(`/api/admin/models?provider_id=${providerId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModels(data.models ?? []);
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    if (selectedProviderId) {
      fetchKeys(selectedProviderId);
      fetchModels(selectedProviderId);
    } else {
      setKeys([]);
      setModels([]);
    }
  }, [selectedProviderId, fetchKeys, fetchModels]);

  const selectProvider = (p: ProviderWithCounts) => {
    setSelectedProviderId(p.id);
  };

  const handleAddProvider = async () => {
    if (!providerForm.name.trim()) { toast.error("Name required"); return; }
    if (!providerForm.base_url.trim()) { toast.error("Base URL required"); return; }
    setSavingProvider(true);
    try {
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...providerForm, type: "openai_compatible" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("models.providerCreated"));
      setAddProviderOpen(false);
      setProviderForm({ name: "", base_url: "" });
      fetchProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingProvider(false);
    }
  };

  const handleToggleProvider = async (p: ProviderWithCounts) => {
    const newEnabled = !p.enabled;
    setProviders((prev) =>
      prev.map((item) => (item.id === p.id ? { ...item, enabled: newEnabled } : item))
    );
    try {
      const res = await fetch("/api/admin/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, enabled: newEnabled }),
      });
      if (!res.ok) throw new Error("Failed");
      fetchProviders();
    } catch (err) {
      setProviders((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, enabled: p.enabled } : item))
      );
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleAddKey = async () => {
    if (!keyForm.api_key.trim() || !selectedProvider) return;
    setSavingKey(true);
    try {
      const res = await fetch("/api/admin/providers/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: selectedProvider.id, ...keyForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("models.keyAdded"));
      setAddKeyOpen(false);
      setKeyForm({ api_key: "", label: "" });
      fetchKeys(selectedProvider.id);
      fetchProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingKey(false);
    }
  };

  const handleToggleKey = async (k: ApiKeyInfo) => {
    const newActive = !k.is_active;
    setKeys((prev) =>
      prev.map((item) => (item.id === k.id ? { ...item, is_active: newActive } : item))
    );
    try {
      const res = await fetch("/api/admin/providers/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: k.id, is_active: newActive }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setKeys((prev) =>
        prev.map((item) => (item.id === k.id ? { ...item, is_active: k.is_active } : item))
      );
    }
  };

  const handleAddModel = async () => {
    if (!modelForm.model_id.trim() || !modelForm.label.trim() || !selectedProvider) return;
    setSavingModel(true);
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: selectedProvider.id, ...modelForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("models.modelAdded"));
      setAddModelOpen(false);
      setModelForm({ model_id: "", label: "" });
      fetchModels(selectedProvider.id);
      fetchProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingModel(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const urlMap = {
        provider: `/api/admin/providers?id=${deleteTarget.id}`,
        key: `/api/admin/providers/keys?id=${deleteTarget.id}`,
        model: `/api/admin/models?id=${deleteTarget.id}`,
      };
      const res = await fetch(urlMap[deleteTarget.type], { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }

      if (deleteTarget.type === "provider") {
        toast.success(t("models.providerDeleted"));
        if (selectedProviderId === deleteTarget.id) {
          setSelectedProviderId(null);
        }
      } else if (deleteTarget.type === "key") {
        toast.success(t("models.keyDeleted"));
        if (selectedProvider) fetchKeys(selectedProvider.id);
      } else {
        toast.success(t("models.modelDeleted"));
        if (selectedProvider) fetchModels(selectedProvider.id);
      }
      fetchProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div><Skeleton className="h-8 w-40" /><Skeleton className="mt-2 h-4 w-64" /></div>
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("models.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("models.subtitle")}</p>
        </div>
        <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
          <DialogTrigger render={<Button onClick={() => setAddProviderOpen(true)} />}>
            <Plus className="mr-1.5 size-4" />
            {t("models.addProvider")}
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("models.addProvider")}</DialogTitle>
              <DialogDescription>{t("models.addProviderDesc")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t("models.providerName")}</Label>
                <Input value={providerForm.name} onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("models.providerNamePlaceholder")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("models.baseUrl")} <span className="text-destructive">*</span></Label>
                <Input value={providerForm.base_url} onChange={(e) => setProviderForm((f) => ({ ...f, base_url: e.target.value }))} placeholder={t("models.baseUrlPlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("models.baseUrlHint")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddProviderOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={handleAddProvider} disabled={savingProvider}>{savingProvider ? t("common.saving") : t("common.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Provider List */}
        <div className="flex flex-col gap-1.5">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProvider(p)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all hover:bg-muted/50",
                selectedProvider?.id === p.id && "border-primary bg-primary/5 shadow-sm"
              )}
            >
              <div className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                p.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {p.is_builtin ? <Cpu className="size-4" /> : <Globe className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  {p.is_builtin && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t("models.builtin")}</Badge>}
                </div>
                <div className="flex gap-2 text-[11px] text-muted-foreground">
                  <span>{p.model_count} models</span>
                  <span>{p.key_count} keys</span>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>

        {/* Detail Panel */}
        {selectedProvider ? (
          <div className="flex flex-col gap-6">
            {/* Provider Header */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {selectedProvider.name}
                      <Badge variant={selectedProvider.enabled ? "default" : "secondary"}>
                        {selectedProvider.enabled ? t("models.enabled") : t("models.disabled")}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {selectedProvider.type}
                      {selectedProvider.base_url && ` · ${selectedProvider.base_url}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={selectedProvider.enabled}
                      onCheckedChange={() => handleToggleProvider(selectedProvider)}
                    />
                    {!selectedProvider.is_builtin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ type: "provider", id: selectedProvider.id, name: selectedProvider.name })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* API Keys */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Key className="size-4" />
                    {t("models.apiKeys")}
                  </CardTitle>
                  <Dialog open={addKeyOpen} onOpenChange={setAddKeyOpen}>
                    <DialogTrigger render={<Button size="sm" variant="outline" onClick={() => setAddKeyOpen(true)} />}>
                      <Plus className="mr-1 size-3.5" />
                      {t("models.addKey")}
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t("models.addKey")}</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("models.keyLabel")}</Label>
                          <Input value={keyForm.label} onChange={(e) => setKeyForm((f) => ({ ...f, label: e.target.value }))} placeholder={t("models.keyLabelPlaceholder")} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("models.apiKey")}</Label>
                          <Input type="password" value={keyForm.api_key} onChange={(e) => setKeyForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={t("models.apiKeyPlaceholder")} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddKeyOpen(false)}>{t("common.cancel")}</Button>
                        <Button onClick={handleAddKey} disabled={savingKey}>{savingKey ? t("common.saving") : t("common.save")}</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {keys.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t("models.noKeys")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {keys.map((k) => (
                      <div key={k.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Switch checked={k.is_active} onCheckedChange={() => handleToggleKey(k)} />
                          <div>
                            <span className="text-sm font-medium">{k.label || "Unnamed Key"}</span>
                            <p className="text-xs text-muted-foreground">
                              {k.call_count} {t("models.calls")} · {new Date(k.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget({ type: "key", id: k.id, name: k.label || "key" })}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Models */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="size-4" />
                    {t("models.modelList")}
                  </CardTitle>
                  <Dialog open={addModelOpen} onOpenChange={setAddModelOpen}>
                    <DialogTrigger render={<Button size="sm" variant="outline" onClick={() => setAddModelOpen(true)} />}>
                      <Plus className="mr-1 size-3.5" />
                      {t("models.addModel")}
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t("models.addModel")}</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("models.modelId")}</Label>
                          <Input value={modelForm.model_id} onChange={(e) => setModelForm((f) => ({ ...f, model_id: e.target.value }))} placeholder={t("models.modelIdPlaceholder")} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("models.modelLabel")}</Label>
                          <Input value={modelForm.label} onChange={(e) => setModelForm((f) => ({ ...f, label: e.target.value }))} placeholder={t("models.modelLabelPlaceholder")} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddModelOpen(false)}>{t("common.cancel")}</Button>
                        <Button onClick={handleAddModel} disabled={savingModel}>{savingModel ? t("common.saving") : t("common.save")}</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {models.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{t("models.noModels")}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {models.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                        <div>
                          <span className="text-sm font-medium">{m.label}</span>
                          <p className="text-xs font-mono text-muted-foreground">{m.model_id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {m.is_builtin && <Badge variant="secondary" className="text-[10px]">{t("models.builtin")}</Badge>}
                          {!m.is_builtin && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget({ type: "model", id: m.id, name: m.label })}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20">
              <Cpu className="size-10 text-muted-foreground/40 mb-4" />
              <p className="text-sm text-muted-foreground">{t("models.noProviderSelected")}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("common.delete")}
        description={deleteTarget?.type === "provider"
          ? t("models.deleteProviderConfirm", { name: deleteTarget.name })
          : `Delete "${deleteTarget?.name}"?`}
        confirmText={t("common.delete")}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
