"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  Server,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n";
import type {
  UpdateManifest,
  UpdateRunRecord,
} from "@/lib/system-update/types";

type UpdateStateResponse = {
  upstreamRepo: string;
  installMode: string;
  githubRepo: string;
  githubDefaultBranch: string;
  runtimeVersion: {
    packageVersion: string;
    releaseTag: string;
    commitSha: string;
  };
  installedReleaseTag: string;
  installedCommitSha: string;
  lastCheckedReleaseTag: string;
  lastCheckedAt: string;
  lastUpdateStatus: string;
  githubConfigured: boolean;
  vercelConfigured: boolean;
  needsBaseline: boolean;
  activeRun: UpdateRunRecord | null;
  latestRun: UpdateRunRecord | null;
  latestRelease: {
    tag: string;
    name: string;
    body: string;
    publishedAt: string;
    htmlUrl: string;
  } | null;
  latestManifest: UpdateManifest | null;
  upgradeAvailable: boolean;
  missingConfig: string[];
};

const RUN_POLL_INTERVAL_MS = 5000;
type Translator = ReturnType<typeof useT>;

export default function UpdatesPage() {
  const t = useT();
  const [state, setState] = useState<UpdateStateResponse | null>(null);
  const [runs, setRuns] = useState<UpdateRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState<string | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState<string | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [dbDialogRun, setDbDialogRun] = useState<UpdateRunRecord | null>(null);
  const [rollbackDialogRun, setRollbackDialogRun] = useState<UpdateRunRecord | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/admin/system/update/runs?limit=10", {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || t("updates.loadFailed"));
    }
    setRuns(data.runs ?? []);
  }, [t]);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/admin/system/update", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || t("updates.loadFailed"));
    }
    setState(data);
  }, [t]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadState(), loadRuns()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [loadRuns, loadState, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const activeRunId = state?.activeRun?.id;
    if (!activeRunId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/system/update/runs/${activeRunId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || t("updates.pollFailed"));
        }
        const run = data.run as UpdateRunRecord;
        setState((current) =>
          current
            ? {
                ...current,
                activeRun: isTerminalStatus(run.status) ? null : run,
                latestRun: run,
                lastUpdateStatus: run.status,
                installedReleaseTag:
                  run.status === "success"
                    ? run.to_release_tag
                    : run.status === "rolled_back"
                      ? run.from_release_tag
                      : current.installedReleaseTag,
                installedCommitSha:
                  run.status === "success"
                    ? run.patch_commit_sha || current.installedCommitSha
                    : run.status === "rolled_back"
                      ? run.from_commit_sha || current.installedCommitSha
                      : current.installedCommitSha,
              }
            : current,
        );
        setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 10));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("updates.pollFailed"));
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, RUN_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state?.activeRun?.id, t]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("updates.checkFailed"));
      setState(data);
      toast.success(t("updates.checkSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  const handleInitializeBaseline = async () => {
    setBaselineLoading(true);
    try {
      const res = await fetch("/api/admin/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initialize_baseline" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("updates.baselineFailed"));
      setState(data.state);
      setBaselineDialogOpen(false);
      toast.success(t("updates.baselineSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.baselineFailed"));
    } finally {
      setBaselineLoading(false);
    }
  };

  const handleStartUpdate = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/admin/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("updates.startFailed"));
      setStartDialogOpen(false);
      toast.success(t("updates.startSuccess"));
      await Promise.all([loadState(), loadRuns()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const handleApplyDb = async () => {
    if (!dbDialogRun) return;
    setDbLoading(dbDialogRun.id);
    try {
      const res = await fetch("/api/admin/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_db", runId: dbDialogRun.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("updates.applyDbFailed"));
      setDbDialogRun(null);
      toast.success(t("updates.applyDbSuccess"));
      await Promise.all([loadState(), loadRuns()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.applyDbFailed"));
    } finally {
      setDbLoading(null);
    }
  };

  const handleRollback = async () => {
    if (!rollbackDialogRun) return;
    setRollbackLoading(rollbackDialogRun.id);
    try {
      const res = await fetch("/api/admin/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rollback", runId: rollbackDialogRun.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("updates.rollbackFailed"));
      setRollbackDialogRun(null);
      toast.success(t("updates.rollbackStarted"));
      await Promise.all([loadState(), loadRuns()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updates.rollbackFailed"));
    } finally {
      setRollbackLoading(null);
    }
  };

  const activeRun = state?.activeRun ?? null;
  const latestManifest = state?.latestManifest ?? null;

  const releaseNotes = useMemo(() => {
    const raw = latestManifest?.notes_md || state?.latestRelease?.body || "";
    return raw.trim();
  }, [latestManifest?.notes_md, state?.latestRelease?.body]);

  if (loading || !state) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("updates.title")}</h1>
          <p className="text-muted-foreground">{t("updates.subtitle")}</p>
        </div>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {t("common.loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const configReady = state.githubConfigured && state.vercelConfigured;
  const canStart =
    configReady &&
    !state.needsBaseline &&
    state.upgradeAvailable &&
    !activeRun &&
    Boolean(state.latestManifest);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("updates.title")}</h1>
          <p className="text-muted-foreground">{t("updates.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
          {checking ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          {t("common.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("updates.statusTitle")}</CardTitle>
          <CardDescription>{t("updates.statusDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatusItem
            icon={Sparkles}
            label={t("updates.currentInstalled")}
            value={state.installedReleaseTag || t("updates.unknownVersion")}
            hint={state.installedCommitSha || t("updates.noCommitRecorded")}
          />
          <StatusItem
            icon={GitBranch}
            label={t("updates.runtimeVersion")}
            value={state.runtimeVersion.releaseTag}
            hint={state.runtimeVersion.commitSha || t("updates.noCommitRecorded")}
          />
          <StatusItem
            icon={Rocket}
            label={t("updates.latestUpstream")}
            value={state.latestRelease?.tag || t("updates.notCheckedYet")}
            hint={state.latestRelease?.publishedAt ? new Date(state.latestRelease.publishedAt).toLocaleString() : ""}
          />
          <StatusItem
            icon={Server}
            label={t("updates.updateState")}
            value={renderRunStatusLabel(t, activeRun?.status || state.lastUpdateStatus)}
            hint={state.lastCheckedAt ? t("updates.lastCheckedAt", { time: new Date(state.lastCheckedAt).toLocaleString() }) : ""}
          />
        </CardContent>
      </Card>

      {!configReady && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-950">
              <AlertTriangle className="size-5" />
              {t("updates.setupRequiredTitle")}
            </CardTitle>
            <CardDescription className="text-amber-900/80">
              {t("updates.setupRequiredDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {state.missingConfig.map((item) => (
                <Badge key={item} variant="outline" className="border-amber-400 text-amber-950">
                  {item}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/coding?tab=github" className={buttonVariants()}>
                {t("updates.goToCoding")}
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {state.needsBaseline && (
        <Card className="border-sky-300 bg-sky-50/70">
          <CardHeader>
            <CardTitle>{t("updates.baselineTitle")}</CardTitle>
            <CardDescription>{t("updates.baselineDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => setBaselineDialogOpen(true)}>
              {t("updates.initializeBaseline")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("updates.availableTitle")}</CardTitle>
          <CardDescription>{t("updates.availableDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {t("updates.fromVersion", {
                version: state.installedReleaseTag || t("updates.unknownVersion"),
              })}
            </Badge>
            <Badge variant="outline">
              {t("updates.toVersion", {
                version: state.latestRelease?.tag || t("updates.notCheckedYet"),
              })}
            </Badge>
            {latestManifest?.db.mode === "manual_apply" ? (
              <Badge>{t("updates.dbChange")}</Badge>
            ) : null}
            {(latestManifest?.required_env_keys?.length ?? 0) > 0 ? (
              <Badge variant="secondary">{t("updates.envChange")}</Badge>
            ) : null}
          </div>

          {releaseNotes ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap line-clamp-6">
              {releaseNotes}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("updates.noReleaseNotes")}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStartDialogOpen(true)} disabled={!canStart}>
              {activeRun ? t("updates.runInProgress") : t("updates.startUpgrade")}
            </Button>
            {state.latestRelease?.htmlUrl ? (
              <a
                href={state.latestRelease.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                <ExternalLink className="mr-2 size-4" />
                {t("updates.viewRelease")}
              </a>
            ) : null}
          </div>

          {!state.upgradeAvailable && !state.needsBaseline && configReady ? (
            <p className="text-sm text-muted-foreground">{t("updates.upToDateHint")}</p>
          ) : null}
        </CardContent>
      </Card>

      {activeRun && (
        <Card>
          <CardHeader>
            <CardTitle>{t("updates.activeRunTitle")}</CardTitle>
            <CardDescription>{t("updates.activeRunDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <UpdateTimeline run={activeRun} t={t} />
            {activeRun.error_summary ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {activeRun.error_summary}
              </div>
            ) : null}
            {renderRunDetails(activeRun, t)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("updates.historyTitle")}</CardTitle>
          <CardDescription>{t("updates.historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("updates.noRuns")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("updates.tableVersion")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.updated")}</TableHead>
                  <TableHead>{t("common.details")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const canRollback =
                    !activeRun &&
                    (run.status === "success" || run.status === "deploy_error");
                  const canApplyDb = !activeRun && run.status === "db_pending";
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-sm">
                        {run.from_release_tag} → {run.to_release_tag}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariantForRun(run.status)}>
                          {renderRunStatusLabel(t, run.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(run.updated_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                        {run.error_summary || summaryFromRun(run, t)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {canApplyDb ? (
                            <Button size="sm" onClick={() => setDbDialogRun(run)}>
                              {t("updates.applyDb")}
                            </Button>
                          ) : null}
                          {canRollback ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRollbackDialogRun(run)}
                            >
                              <RotateCcw className="mr-2 size-4" />
                              {t("updates.rollback")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("updates.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("updates.confirmDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <InfoBlock label={t("updates.currentInstalled")} value={state.installedReleaseTag || t("updates.unknownVersion")} />
              <InfoBlock label={t("updates.latestUpstream")} value={state.latestRelease?.tag || t("updates.notCheckedYet")} />
            </div>
            {(latestManifest?.required_env_keys?.length ?? 0) > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium">{t("updates.requiredEnv")}</p>
                <div className="flex flex-wrap gap-2">
                  {latestManifest?.required_env_keys?.map((key) => (
                    <Badge key={key} variant="secondary">{key}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {latestManifest?.db.mode === "manual_apply"
                  ? t("updates.dbChange")
                  : t("updates.noDbChange")}
              </Badge>
              <Badge variant="outline">
                {latestManifest?.patches?.length
                  ? t("updates.patchCount", { count: latestManifest.patches.length })
                  : t("updates.patchCount", { count: 0 })}
              </Badge>
            </div>
            {releaseNotes ? (
              <div className="max-h-56 overflow-auto rounded-lg border bg-muted/30 p-3 whitespace-pre-wrap">
                {releaseNotes}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStartDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleStartUpdate} disabled={starting}>
              {starting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t("updates.startUpgrade")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={baselineDialogOpen}
        onOpenChange={setBaselineDialogOpen}
        title={t("updates.baselineTitle")}
        description={t("updates.baselineConfirm")}
        confirmText={t("updates.initializeBaseline")}
        loading={baselineLoading}
        variant="default"
        onConfirm={() => void handleInitializeBaseline()}
      />

      <ConfirmDialog
        open={Boolean(dbDialogRun)}
        onOpenChange={(open) => !open && !dbLoading && setDbDialogRun(null)}
        title={t("updates.applyDbTitle")}
        description={t("updates.applyDbDesc")}
        confirmText={t("updates.applyDb")}
        loading={Boolean(dbLoading)}
        variant="default"
        onConfirm={() => void handleApplyDb()}
      />

      <ConfirmDialog
        open={Boolean(rollbackDialogRun)}
        onOpenChange={(open) => !open && !rollbackLoading && setRollbackDialogRun(null)}
        title={t("updates.rollbackTitle")}
        description={t("updates.rollbackDesc")}
        confirmText={t("updates.rollback")}
        loading={Boolean(rollbackLoading)}
        onConfirm={() => void handleRollback()}
      />
    </div>
  );
}

function StatusItem({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="break-all text-sm font-semibold">{value}</p>
      {hint ? <p className="mt-1 break-all text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium break-all">{value}</p>
    </div>
  );
}

function UpdateTimeline({
  run,
  t,
}: {
  run: UpdateRunRecord;
  t: Translator;
}) {
  const steps = [
    { key: "check", label: t("updates.timelineCheck"), done: true },
    {
      key: "patch",
      label: t("updates.timelinePatch"),
      done: !["checking", "blocked"].includes(run.status),
    },
    {
      key: "deploy",
      label: t("updates.timelineDeploy"),
      done: !["checking", "patching"].includes(run.status),
      current: ["deploy_pending", "rollback_running"].includes(run.status),
    },
    {
      key: "db",
      label: t("updates.timelineDb"),
      done: ["success", "rolled_back"].includes(run.status) || run.status === "db_pending",
      current: run.status === "db_running",
    },
    {
      key: "done",
      label: t("updates.timelineDone"),
      done: ["success", "rolled_back"].includes(run.status),
      current: !isTerminalStatus(run.status),
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((step) => (
        <div
          key={step.key}
          className={`rounded-lg border p-3 text-sm ${
            step.done
              ? "border-emerald-300 bg-emerald-50"
              : step.current
                ? "border-blue-300 bg-blue-50"
                : "bg-muted/20"
          }`}
        >
          <div className="flex items-center gap-2">
            {step.done ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : step.current ? (
              <Clock3 className="size-4 text-blue-600" />
            ) : (
              <div className="size-4 rounded-full border" />
            )}
            <span>{step.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderRunDetails(run: UpdateRunRecord, t: Translator) {
  const details = run.details_json || {};
  const buildLogs =
    typeof details.build_logs === "string"
      ? details.build_logs
      : typeof details.rollback_build_logs === "string"
        ? details.rollback_build_logs
        : "";
  const blockedFiles = Array.isArray(details.blocked_files)
    ? (details.blocked_files as string[])
    : [];

  if (!buildLogs && blockedFiles.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
      {blockedFiles.length > 0 ? (
        <div className="mb-3">
          <p className="font-medium">{t("updates.blockedFiles")}</p>
          <p className="mt-1 text-muted-foreground">{blockedFiles.join(", ")}</p>
        </div>
      ) : null}
      {buildLogs ? (
        <div>
          <p className="font-medium">{t("updates.logs")}</p>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
            {buildLogs}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function summaryFromRun(run: UpdateRunRecord, t: Translator) {
  const details = run.details_json || {};
  if (typeof details.db_summary === "string" && details.db_summary.trim()) {
    return details.db_summary;
  }
  if (typeof details.latest_release_name === "string" && details.latest_release_name.trim()) {
    return details.latest_release_name;
  }
  if (run.status === "deploy_pending") {
    return t("updates.summaryPatchApplied");
  }
  if (run.status === "deploy_error") {
    return t("updates.summaryDeployFailed");
  }
  if (run.status === "db_pending") {
    return t("updates.summaryDbPending");
  }
  if (run.status === "rollback_running") {
    return t("updates.summaryRollbackRunning");
  }
  return "";
}

function badgeVariantForRun(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "success" || status === "rolled_back") return "default";
  if (status === "deploy_error" || status === "failed" || status === "blocked") return "destructive";
  if (status === "db_pending") return "secondary";
  return "outline";
}

function renderRunStatusLabel(
  t: Translator,
  status: string,
) {
  switch (status) {
    case "checking":
      return t("updates.statusChecking");
    case "blocked":
      return t("updates.statusBlocked");
    case "patching":
      return t("updates.statusPatching");
    case "deploy_pending":
      return t("updates.statusDeployPending");
    case "deploy_ready":
      return t("updates.statusDeployReady");
    case "deploy_error":
      return t("updates.statusDeployError");
    case "db_pending":
      return t("updates.statusDbPending");
    case "db_running":
      return t("updates.statusDbRunning");
    case "rollback_running":
      return t("updates.statusRollbackRunning");
    case "rolled_back":
      return t("updates.statusRolledBack");
    case "success":
      return t("updates.statusSuccess");
    case "failed":
      return t("updates.statusFailed");
    default:
      return status || t("updates.statusIdle");
  }
}

function isTerminalStatus(status: string) {
  return ["blocked", "success", "deploy_error", "rolled_back", "failed"].includes(status);
}
