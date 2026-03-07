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
import { toast } from "sonner";
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

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/secrets");
      const data = await res.json();
      setSecrets(data.secrets ?? []);
    } catch {
      toast.error("Failed to load secrets");
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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      const res = await fetch(`/api/admin/secrets?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`${name} deleted`);
      fetchSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Secrets</h1>
          <p className="text-muted-foreground">
            Manage encrypted API keys and tokens
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            Add Secret
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add or Update Secret</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <Label>Key Name</Label>
                <Select value={newKeyName} onValueChange={(v) => setNewKeyName(v ?? "")}>
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
              <div className="flex flex-col gap-2">
                <Label>Value</Label>
                <Input
                  type="password"
                  placeholder="Paste key value..."
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
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
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : secrets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No secrets configured yet.
            </p>
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
                        size="sm"
                        onClick={() => handleDelete(s.id, s.key_name)}
                      >
                        Delete
                      </Button>
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
