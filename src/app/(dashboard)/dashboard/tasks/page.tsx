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
import { TablePagination } from "@/components/table-pagination";
import { useT } from "@/lib/i18n";

const PAGE_SIZE = 20;

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
  const t = useT();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);

  const fetchTasks = useCallback(
    async (p: number, forceReconcile = false) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(p),
          page_size: String(PAGE_SIZE),
        });
        if (forceReconcile) qs.set("reconcile", "1");
        const res = await fetch(
          `/api/admin/tasks?${qs.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("tasks.loadFailed"));
        setTasks(data.tasks ?? []);
        setTotal(data.total ?? 0);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("tasks.loadFailed")
        );
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchTasks(page);
  }, [page, fetchTasks]);

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
      if (!res.ok) throw new Error(data.error || t("common.delete"));
      toast.success(t("tasks.taskDeleted", { name }));
      setDeleteTarget(null);
      fetchTasks(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.delete"));
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

  function getTypeLabel(type: string) {
    if (type === "reminder") return t("tasks.reminder");
    if (type === "agent_invoke") return t("tasks.agentInvoke");
    if (type === "webhook") return t("tasks.webhook");
    return type;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("tasks.title")}
          </h1>
          <p className="text-muted-foreground">{t("tasks.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchTasks(page, true)}
        >
          <RefreshCw className="mr-2 size-4" />
          {t("common.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("tasks.scheduledTasks")}</CardTitle>
          <CardDescription>{t("tasks.scheduledTasksDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("tasks.noTasks")}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("tasks.name")}</TableHead>
                    <TableHead>{t("tasks.type")}</TableHead>
                    <TableHead>{t("tasks.schedule")}</TableHead>
                    <TableHead>{t("tasks.agent")}</TableHead>
                    <TableHead>{t("tasks.details")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("common.created")}</TableHead>
                    <TableHead className="text-right">
                      {t("common.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-sm">
                        {(task.task_config.job_name as string) || "-"}
                      </TableCell>
                      <TableCell>
                        <TypeBadge
                          label={getTypeLabel(task.task_type)}
                          type={task.task_type}
                        />
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
                          {task.enabled
                            ? t("common.active")
                            : t("common.disabled")}
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
              <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        title={t("tasks.deleteTask")}
        description={t("tasks.deleteTaskConfirm", {
          name: deleteTarget
            ? (deleteTarget.task_config.job_name as string) ||
              deleteTarget.task_type
            : "",
        })}
        confirmText={t("common.delete")}
        loading={!!deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function TypeBadge({ label, type }: { label: string; type: string }) {
  const variant =
    type === "reminder"
      ? "default"
      : type === "agent_invoke"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{label}</Badge>;
}
