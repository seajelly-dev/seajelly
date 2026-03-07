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
import { SECRET_KEYS } from "@/types/database";

interface SecretRow {
  id: string;
  key_name: string;
  updated_at: string;
}

export default function SecretsPage() {
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
        throw new Error(data.error || "Failed to load secrets");
      }
      setSecrets(data.secrets ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load secrets"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleSave = async () => {
    if (!newKeyName || !newValue) {
      toast.error("Both key name and value are required");
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
      toast.error(err instanceof Error ? err.message : "Save failed");
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
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`${deleteTarget.key_name} deleted`);
      setDeleteTarget(null);
      fetchSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage encrypted API keys and tokens
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-1.5 size-4" />
            Add Secret
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add or Update Secret</DialogTitle>
              <DialogDescription>
                Select a key type and provide the value. Values are encrypted
                with AES-256-GCM.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Key Name</Label>
                <Select
                  value={newKeyName}
                  onValueChange={(v) => setNewKeyName(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a key..." />
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
                <Label>Value</Label>
                <Input
                  type="password"
                  placeholder="Paste key value..."
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Keys</CardTitle>
          <CardDescription>
            Values are encrypted with AES-256-GCM. Only key names are shown.
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
                No secrets configured yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key Name</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
        title="Delete Secret"
        description={`Delete "${deleteTarget?.key_name || ""}"?`}
        onConfirm={confirmDeleteSecret}
      />
    </div>
  );
}
