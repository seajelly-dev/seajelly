"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Settings2, RefreshCw, Save, Copy } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SettingsPage() {
  const t = useT();
  const [loading, setLoading] = useState(true);

  const [memoryChannelLimit, setMemoryChannelLimit] = useState("25");
  const [memoryGlobalLimit, setMemoryGlobalLimit] = useState("25");
  const [savingLimits, setSavingLimits] = useState(false);

  const [gateEnabled, setGateEnabled] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pendingAction, setPendingAction] = useState<"generate" | "set" | "disable" | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultLoginUrl, setResultLoginUrl] = useState("");
  const [resultDashboardUrl, setResultDashboardUrl] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, gateRes] = await Promise.all([
        fetch("/api/admin/settings"),
        fetch("/api/admin/settings/login-gate"),
      ]);
      const settingsData = await settingsRes.json();
      const gateData = await gateRes.json();

      setMemoryChannelLimit(settingsData.settings?.memory_inject_limit_channel ?? "25");
      setMemoryGlobalLimit(settingsData.settings?.memory_inject_limit_global ?? "25");
      setGateEnabled(!!gateData.enabled);
    } catch {
      toast.error(t("settings.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveMemoryLimits = async () => {
    const ch = Number(memoryChannelLimit);
    const gl = Number(memoryGlobalLimit);
    if (!Number.isFinite(ch) || !Number.isFinite(gl) || ch < 0 || gl < 0) {
      toast.error(t("settings.invalidMemoryLimit"));
      return;
    }

    setSavingLimits(true);
    try {
      await Promise.all([
        fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "memory_inject_limit_channel",
            value: String(ch),
          }),
        }),
        fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "memory_inject_limit_global",
            value: String(gl),
          }),
        }),
      ]);
      toast.success(t("settings.memoryLimitSaved"));
    } catch {
      toast.error(t("settings.saveFailed"));
    } finally {
      setSavingLimits(false);
    }
  };

  const applyGateAction = async (mode: "generate" | "set", key?: string) => {
    setRotating(true);
    try {
      const res = await fetch("/api/admin/settings/login-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "generate" ? { mode } : { mode, key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      setGateEnabled(true);
      setGeneratedUrl(data.loginUrl ?? "");
      setResultLoginUrl(data.loginUrl ?? "");
      setResultDashboardUrl(data.dashboardUrl ?? "");
      setResultOpen(true);
      if (mode === "set") {
        setCustomKey("");
      }
      toast.success(
        mode === "generate" ? t("settings.gateKeyRotated") : t("settings.gateKeyUpdated")
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setRotating(false);
    }
  };

  const requestGenerate = () => {
    if (!gateEnabled) {
      setPendingAction("generate");
      setConfirmText("");
      setConfirmOpen(true);
      return;
    }
    void applyGateAction("generate");
  };

  const requestDisable = () => {
    if (!gateEnabled) return;
    setPendingAction("disable");
    setConfirmText("");
    setConfirmOpen(true);
  };

  const requestSetCustom = () => {
    const key = customKey.trim();
    if (key.length < 16) {
      toast.error(t("settings.customKeyTooShort"));
      return;
    }

    if (!gateEnabled) {
      setPendingAction("set");
      setConfirmText("");
      setConfirmOpen(true);
      return;
    }
    void applyGateAction("set", key);
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const expected = pendingAction === "disable" ? "DISABLE" : "ENABLE";
    if (confirmText !== expected) return;
    setConfirmOpen(false);
    if (pendingAction === "disable") {
      setRotating(true);
      try {
        const res = await fetch("/api/admin/settings/login-gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "disable" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        setGateEnabled(false);
        setGeneratedUrl("");
        setResultLoginUrl("");
        setResultDashboardUrl("");
        toast.success(t("settings.gateDisabled"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("settings.saveFailed"));
      } finally {
        setRotating(false);
      }
      return;
    }

    if (pendingAction === "generate") {
      await applyGateAction("generate");
      return;
    }
    const key = customKey.trim();
    if (key.length < 16) {
      toast.error(t("settings.customKeyTooShort"));
      return;
    }
    await applyGateAction("set", key);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("settings.copySuccess"));
    } catch {
      toast.error(t("settings.copyFailed"));
    }
  };

  const confirmExpected = pendingAction === "disable" ? "DISABLE" : "ENABLE";
  const confirmTitle =
    pendingAction === "disable"
      ? t("settings.confirmDisableTitle")
      : t("settings.confirmEnableTitle");
  const confirmDesc =
    pendingAction === "disable"
      ? t("settings.confirmDisableDesc")
      : t("settings.confirmEnableDesc");
  const confirmInputLabel =
    pendingAction === "disable"
      ? t("settings.confirmDisableInputLabel")
      : t("settings.confirmEnableInputLabel");
  const confirmButtonText =
    pendingAction === "disable"
      ? t("settings.confirmDisableButton")
      : t("settings.confirmEnableButton");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="size-5 text-muted-foreground" />
            <CardTitle>{t("settings.memoryTitle")}</CardTitle>
          </div>
          <CardDescription>{t("settings.memoryDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label>{t("settings.memoryChannelLimit")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  className="w-36"
                  value={memoryChannelLimit}
                  onChange={(e) => setMemoryChannelLimit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.memoryGlobalLimit")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  className="w-36"
                  value={memoryGlobalLimit}
                  onChange={(e) => setMemoryGlobalLimit(e.target.value)}
                />
              </div>
              <Button onClick={saveMemoryLimits} disabled={savingLimits}>
                <Save className="mr-1 size-4" />
                {savingLimits ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-muted-foreground" />
            <CardTitle>{t("settings.loginGateTitle")}</CardTitle>
          </div>
          <CardDescription>{t("settings.loginGateDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("settings.currentStatus")}: </span>
              <span className={gateEnabled ? "text-green-600" : "text-amber-600"}>
                {gateEnabled ? t("settings.enabled") : t("settings.disabled")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("settings.loginGateSwitch")}
              </Label>
              <Switch
                checked={gateEnabled}
                disabled={rotating}
                onCheckedChange={(next) => {
                  if (next) {
                    requestGenerate();
                  } else {
                    requestDisable();
                  }
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t("settings.customKey")}</Label>
              <Input
                placeholder={t("settings.customKeyPlaceholder")}
                className="w-[360px] max-w-full"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={requestSetCustom} disabled={rotating}>
              {t("settings.applyCustomKey")}
            </Button>
            <Button onClick={requestGenerate} disabled={rotating}>
              <RefreshCw className="mr-1 size-4" />
              {t("settings.regenerateKey")}
            </Button>
          </div>

          {generatedUrl ? (
            <div className="space-y-1.5">
              <Label>{t("settings.latestLoginUrl")}</Label>
              <Textarea value={generatedUrl} readOnly rows={3} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{confirmInputLabel}</Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmExpected}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={confirmAction}
              disabled={confirmText !== confirmExpected || rotating}
            >
              {confirmButtonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("settings.resultDialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.resultDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("settings.latestLoginUrl")}</Label>
              <div className="flex gap-2">
                <Textarea value={resultLoginUrl} readOnly rows={3} />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => copyToClipboard(resultLoginUrl)}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.dashboardUrlLabel")}</Label>
              <div className="flex gap-2">
                <Textarea value={resultDashboardUrl} readOnly rows={3} />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => copyToClipboard(resultDashboardUrl)}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setResultOpen(false)}>{t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
