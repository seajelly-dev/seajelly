"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Trash2, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface TaskRow {
  id: string;
  agent_id: string;
  agent_name: string;
  schedule: string;
  task_type: string;
  task_config: Record<string, unknown>;
  enabled: boolean;
  last_run: string | null;
  created_at: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tasks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tasks");
      setTasks(data.tasks ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const name =
      (deleteTarget.task_config.job_name as string) || deleteTarget.task_type;
    setDeleting(deleteTarget.id);
    try {
      const res = await fetch(`/api/admin/tasks?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success(`Task "${name}" deleted`);
      setDeleteTarget(null);
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  function getTaskLabel(task: TaskRow) {
    const config = task.task_config;
    if (task.task_type === "reminder") return (config.message as string) || "-";
    if (task.task_type === "agent_invoke")
      return (config.prompt as string) || "-";
    if (task.task_type === "webhook") return (config.url as string) || "-";
    return "-";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">
            Manage scheduled cron jobs and reminders
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchTasks();
          }}
        >
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Tasks</CardTitle>
          <CardDescription>
            Tasks created by agents via pg_cron. Deleting here also removes the
            underlying pg_cron job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scheduled tasks. Ask your agent to set a reminder or schedule a
              task.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-sm">
                      {(task.task_config.job_name as string) || "-"}
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={task.task_type} />
                      {!!task.task_config.once && (
                        <Badge variant="outline" className="ml-1">
                          once
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {task.schedule}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{task.agent_name}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {getTaskLabel(task)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={task.enabled ? "default" : "secondary"}
                      >
                        {task.enabled ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(task.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === task.id}
                        onClick={() => setDeleteTarget(task)}
                      >
                        <Trash2 className="size-4" />
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
        title="Delete Task"
        description={`Delete task "${deleteTarget ? (deleteTarget.task_config.job_name as string) || deleteTarget.task_type : ""}"? This will also remove the pg_cron job.`}
        loading={!!deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const variant =
    type === "reminder"
      ? "default"
      : type === "agent_invoke"
        ? "secondary"
        : "outline";
  const label =
    type === "reminder"
      ? "Reminder"
      : type === "agent_invoke"
        ? "Agent Invoke"
        : type === "webhook"
          ? "Webhook"
          : type;
  return <Badge variant={variant}>{label}</Badge>;
}
