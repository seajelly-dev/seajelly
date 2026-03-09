"use client";

import { useState, useEffect, useCallback } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import { SECRET_KEYS } from "@/types/database";

interface SecretRow {
  id: string;
  key_name: string;
  updated_at: string;
}

export default function SecretsPage() {
  const t = useT();
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState<string>("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecretRow | null>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/secrets");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("secrets.loadFailed"));
      }
      setSecrets(data.secrets ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("secrets.loadFailed")
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleSave = async () => {
    if (!newKeyName || !newValue) {
      toast.error(t("secrets.bothRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_name: newKeyName, value: newValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${newKeyName} saved`);
      setDialogOpen(false);
      setNewKeyName("");
      setNewValue("");
      fetchSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.saving"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSecret = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/secrets?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(t("secrets.deleteFailed"));
      toast.success(`${deleteTarget.key_name} deleted`);
      setDeleteTarget(null);
      fetchSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("secrets.deleteFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("secrets.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("secrets.subtitle")}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger id="secrets-add-dialog-trigger" render={<Button />}>
            <Plus className="mr-1.5 size-4" />
            {t("secrets.addSecret")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("secrets.addOrUpdate")}</DialogTitle>
              <DialogDescription>
                {t("secrets.addOrUpdateDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t("secrets.keyName")}</Label>
                <Select
                  value={newKeyName}
                  onValueChange={(v) => setNewKeyName(v ?? "")}
                >
                  <SelectTrigger id="secrets-key-select-trigger">
                    <SelectValue placeholder={t("secrets.selectKey")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SECRET_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("secrets.value")}</Label>
                <Input
                  type="password"
                  placeholder={t("secrets.valuePlaceholder")}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                className="w-full sm:w-auto"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("secrets.configuredKeys")}</CardTitle>
          <CardDescription>
            {t("secrets.configuredKeysDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : secrets.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <KeyRound className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("secrets.noSecrets")}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("secrets.keyName")}</TableHead>
                  <TableHead>{t("secrets.updated")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">
                      {s.key_name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(s.updated_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget(s)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("secrets.deleteSecret")}
        description={t("secrets.deleteSecretConfirm", { name: deleteTarget?.key_name || "" })}
        confirmText={t("common.delete")}
        onConfirm={confirmDeleteSecret}
      />
    </div>
  );
}
