"use client";

import { useState, useEffect, useCallback } from "react";
import NextImage from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Code2,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  KeyRound,
  BookOpen,
  Lightbulb,
  Terminal,
  Globe,
  Boxes,
  Image as ImageIcon,
  AlertTriangle,
  Copy,
  GitBranch,
  Eye,
  Rocket,
} from "lucide-react";
import { useI18n, useT } from "@/lib/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { getUseCaseCategories } from "./use-cases";

type Language = "python" | "javascript" | "html";

interface CodeResult {
  text?: string;
  png?: string;
  html?: string;
}

interface ExecutionOutput {
  stdout: string;
  stderr: string;
  results: CodeResult[];
  error?: string;
  previewUrl?: string;
  executionTimeMs: number;
}

type GitHubTestReport = {
  status: "success" | "error";
  errorCode?: string;
  errorMessage?: string;
  warningCode?: string;
  defaultBranch?: string;
};

export default function CodingPage() {
  const GITHUB_PAT_URL = "https://github.com/settings/personal-access-tokens/new";
  const GITHUB_PERMISSION_DOCS_URL =
    "https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2026-03-10";
  const VERCEL_ACCOUNT_SETTINGS_URL = "https://vercel.com/account/settings";
  const VERCEL_TOKENS_URL = "https://vercel.com/account/settings/tokens";
  const VERCEL_PROJECT_ID_DOCS_URL =
    "https://vercel.com/docs/projects/project-configuration/general-settings";
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const t = useT();
  const useCaseCategories = getUseCaseCategories(locale);
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "github" ? "github" : "e2b";
  const [activeTab, setActiveTab] = useState<"e2b" | "github">(initialTab);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState(t("coding.codePlaceholderPython"));
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<ExecutionOutput | null>(null);

  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [useCasesOpen, setUseCasesOpen] = useState(false);

  const [ghTokenConfigured, setGhTokenConfigured] = useState<boolean | null>(null);
  const [ghRepo, setGhRepo] = useState("");
  const [ghTokenInput, setGhTokenInput] = useState("");
  const [ghRepoInput, setGhRepoInput] = useState("");
  const [ghSaving, setGhSaving] = useState(false);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghTestReport, setGhTestReport] = useState<GitHubTestReport | null>(null);
  const [vercelTokenInput, setVercelTokenInput] = useState("");
  const [vercelProjectIdInput, setVercelProjectIdInput] = useState("");
  const [vercelConfigured, setVercelConfigured] = useState<boolean | null>(null);
  const [vercelSaving, setVercelSaving] = useState(false);

  const checkConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coding/e2b");
      const data = await res.json();
      setConfigured(data.configured ?? false);
    } catch {
      toast.error(t("coding.loadFailed"));
    }
  }, [t]);

  const checkGitHubConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coding/github");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      const data = await res.json();
      setGhTokenConfigured(data.tokenConfigured ?? false);
      setGhRepo(data.repo || "");
      setGhRepoInput(data.repo || "");
      setVercelConfigured(data.vercelConfigured ?? false);
    } catch (err) {
      setGhTokenConfigured(false);
      setGhRepo("");
      setGhRepoInput("");
      setVercelConfigured(false);
      toast.error(err instanceof Error ? err.message : t("coding.githubLoadFailed"));
    }
  }, [t]);

  useEffect(() => {
    checkConfig();
    checkGitHubConfig();
  }, [checkConfig, checkGitHubConfig]);

  useEffect(() => {
    if (tabParam === "github" || tabParam === "e2b") {
      setActiveTab(tabParam);
      return;
    }
    setActiveTab("e2b");
  }, [tabParam]);

  const handleTabChange = (tab: "e2b" | "github") => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "github") {
      params.set("tab", "github");
    } else {
      params.delete("tab");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    if (lang === "python") setCode(t("coding.codePlaceholderPython"));
    else if (lang === "javascript") setCode(t("coding.codePlaceholderJS"));
    else setCode(t("coding.codePlaceholderHTML"));
    setOutput(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/coding/e2b", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(t("coding.e2bTestSuccess"));
      } else {
        toast.error(t("coding.e2bTestFailed", { error: data.error || "Unknown" }));
      }
    } catch {
      toast.error(t("coding.e2bTestFailed", { error: "Network error" }));
    } finally {
      setTesting(false);
    }
  };

  const handleSaveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error(t("coding.e2bKeyRequired"));
      return;
    }
    setSavingKey(true);
    try {
      const res = await fetch("/api/admin/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_name: "E2B_API_KEY", value: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(t("coding.e2bKeySaved"));
      setApiKeyInput("");
      setConfigured(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("coding.e2bKeySaveFailed"));
    } finally {
      setSavingKey(false);
    }
  };

  const handleSaveGitHub = async () => {
    setGhSaving(true);
    setGhTestReport(null);
    try {
      const body: Record<string, string> = {
        action: "save",
        repo: ghRepoInput.trim(),
      };
      if (ghTokenInput.trim()) body.token = ghTokenInput.trim();
      const res = await fetch("/api/admin/coding/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      await checkGitHubConfig();
      toast.success(t("coding.githubConfigSaved"));
      setGhTokenInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("coding.githubConfigSaveFailed"));
    } finally {
      setGhSaving(false);
    }
  };

  const handleTestGitHub = async () => {
    setGhTesting(true);
    setGhTestReport(null);
    try {
      const res = await fetch("/api/admin/coding/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      if (res.ok) {
        setGhTestReport({
          status: "success",
          defaultBranch: data.defaultBranch,
          warningCode: data.warningCode,
        });
        toast.success(t("coding.githubTestSuccess"));
      } else {
        setGhTestReport({
          status: "error",
          errorCode: data.errorCode,
          errorMessage: data.error || "Unknown",
        });
        toast.error(t("coding.githubTestFailed", { error: data.error || "Unknown" }));
      }
    } catch {
      setGhTestReport({
        status: "error",
        errorCode: "unknown",
        errorMessage: "Network error",
      });
      toast.error(t("coding.githubTestFailed", { error: "Network error" }));
    } finally {
      setGhTesting(false);
    }
  };

  const renderGitHubDiagnosis = () => {
    if (!ghTestReport) return null;

    const isSuccess = ghTestReport.status === "success";
    const containerClass = isSuccess
      ? "rounded-lg border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100"
      : "rounded-lg border border-red-200 bg-red-50/80 p-4 text-sm text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100";
    const iconClass = isSuccess
      ? "size-4 text-emerald-600 dark:text-emerald-400"
      : "size-4 text-red-600 dark:text-red-400";

    const details = isSuccess
      ? [
          t("coding.githubDiagnosisOkMeta"),
          t("coding.githubDiagnosisOkPush"),
          t("coding.githubDiagnosisOkWorkflow"),
          ghTestReport.defaultBranch
            ? t("coding.githubDiagnosisDefaultBranch", { branch: ghTestReport.defaultBranch })
            : null,
        ].filter(Boolean)
      : [
          ghTestReport.errorCode === "bad_credentials"
            ? t("coding.githubDiagnosisBadCredentials")
            : ghTestReport.errorCode === "repo_not_found_or_not_selected"
              ? t("coding.githubDiagnosisRepoSelection")
              : ghTestReport.errorCode === "repo_pending_approval_or_denied"
                ? t("coding.githubDiagnosisApproval")
                : ghTestReport.errorCode === "contents_read_missing"
                  ? t("coding.githubDiagnosisContentsRead")
                  : ghTestReport.errorCode === "contents_write_missing"
                    ? t("coding.githubDiagnosisContentsWrite")
                    : t("coding.githubDiagnosisUnknown"),
        ];

    return (
      <div className={containerClass}>
        <div className="flex items-center gap-2 font-medium">
          {isSuccess ? (
            <CheckCircle2 className={iconClass} />
          ) : (
            <AlertTriangle className={iconClass} />
          )}
          {isSuccess
            ? t("coding.githubDiagnosisTitleSuccess")
            : t("coding.githubDiagnosisTitleError")}
        </div>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        {ghTestReport.errorMessage && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium opacity-80">
              {t("coding.githubDiagnosisTechnical")}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-current/15 bg-background/60 p-3 text-xs leading-relaxed text-foreground">
              {ghTestReport.errorMessage}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const handleSaveVercel = async () => {
    const token = vercelTokenInput.trim();
    const projectId = vercelProjectIdInput.trim();
    if (!token && !projectId) return;
    setVercelSaving(true);
    try {
      const saves = [];
      if (token) {
        saves.push(
          fetch("/api/admin/secrets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key_name: "VERCEL_TOKEN", value: token }),
          })
        );
      }
      if (projectId) {
        saves.push(
          fetch("/api/admin/secrets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key_name: "VERCEL_PROJECT_ID", value: projectId }),
          })
        );
      }
      await Promise.all(saves);
      setVercelConfigured(true);
      setVercelTokenInput("");
      setVercelProjectIdInput("");
      toast.success(t("coding.vercelConfigSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("coding.vercelConfigSaveFailed"));
    } finally {
      setVercelSaving(false);
    }
  };

  const handleRunCode = async () => {
    if (!code.trim()) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/admin/coding/e2b/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Execution failed");
        return;
      }
      setOutput(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("coding.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("coding.subtitle")}</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => handleTabChange("e2b")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "e2b"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 className="inline-block mr-1.5 size-4" />
          {t("coding.tabs.e2b")}
        </button>
        <button
          onClick={() => handleTabChange("github")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "github"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("coding.tabs.github")}
        </button>
      </div>

      {activeTab === "github" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GitBranch className="size-5 text-muted-foreground" />
                <CardTitle>{t("coding.githubConfigTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                  {t("coding.githubPermissionTitle")}
                </div>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
                  <li>{t("coding.githubPermissionOwner")}</li>
                  <li>{t("coding.githubPermissionRepoAccess")}</li>
                  <li>{t("coding.githubPermissionContents")}</li>
                  <li>{t("coding.githubPermissionWorkflows")}</li>
                  <li>{t("coding.githubPermissionOrgApproval")}</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  <a
                    href={GITHUB_PAT_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-amber-800 underline underline-offset-4 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-50"
                  >
                    {t("coding.githubTokenDocs")}
                    <ExternalLink className="size-3" />
                  </a>
                  <a
                    href={GITHUB_PERMISSION_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-amber-800 underline underline-offset-4 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-50"
                  >
                    {t("coding.githubPermissionDocs")}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
              {ghTokenConfigured === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : ghTokenConfigured && ghRepo ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3.5" />
                      {t("coding.githubConfigured")}
                    </Badge>
                    <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {ghRepo}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestGitHub}
                      disabled={ghTesting}
                    >
                      {ghTesting ? (
                        <>
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                          {t("coding.githubTesting")}
                        </>
                      ) : (
                        t("coding.githubTestConnection")
                      )}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">{t("coding.githubTokenLabel")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.githubTokenPlaceholder")}
                        value={ghTokenInput}
                        onChange={(e) => setGhTokenInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{t("coding.githubTokenHint")}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">{t("coding.githubRepoLabel")}</Label>
                      <Input
                        placeholder={t("coding.githubRepoPlaceholder")}
                        value={ghRepoInput}
                        onChange={(e) => setGhRepoInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{t("coding.githubRepoHint")}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={handleSaveGitHub}
                    disabled={ghSaving || (!ghTokenInput.trim() && ghRepoInput === ghRepo)}
                  >
                    {ghSaving ? t("common.saving") : t("coding.githubUpdateConfig")}
                  </Button>
                  {renderGitHubDiagnosis()}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3.5" />
                      {t("coding.githubNotConfigured")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("coding.githubConfigGuide")}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("coding.githubTokenLabel")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.githubTokenPlaceholder")}
                        value={ghTokenInput}
                        onChange={(e) => setGhTokenInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{t("coding.githubTokenHint")}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("coding.githubRepoLabel")}</Label>
                      <Input
                        placeholder={t("coding.githubRepoPlaceholder")}
                        value={ghRepoInput}
                        onChange={(e) => setGhRepoInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{t("coding.githubRepoHint")}</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveGitHub}
                    disabled={ghSaving || !ghTokenInput.trim() || !ghRepoInput.trim()}
                    className="w-fit"
                  >
                    {ghSaving ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                        {t("common.saving")}
                      </>
                    ) : (
                      t("coding.githubSaveConfig")
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Rocket className="size-5 text-muted-foreground" />
                <CardTitle>{t("coding.vercelConfigTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {t("coding.vercelConfigDesc")}
              </p>
              <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">{t("coding.vercelTokenLabel")}:</span>{" "}
                    {t("coding.vercelTokenHint")}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">{t("coding.vercelProjectIdLabel")}:</span>{" "}
                    {t("coding.vercelProjectIdHint")}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  <a
                    href={VERCEL_TOKENS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {t("coding.vercelTokenDocs")}
                    <ExternalLink className="size-3" />
                  </a>
                  <a
                    href={VERCEL_PROJECT_ID_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {t("coding.vercelProjectIdDocs")}
                    <ExternalLink className="size-3" />
                  </a>
                  <a
                    href={VERCEL_ACCOUNT_SETTINGS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    vercel.com/account/settings
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
              {vercelConfigured && (
                <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400 mb-4">
                  <CheckCircle2 className="size-3.5" />
                  {t("coding.vercelConfigured")}
                </Badge>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">{t("coding.vercelTokenLabel")}</Label>
                  <Input
                    type="password"
                    placeholder={t("coding.vercelTokenPlaceholder")}
                    value={vercelTokenInput}
                    onChange={(e) => setVercelTokenInput(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("coding.vercelTokenHint")}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">{t("coding.vercelProjectIdLabel")}</Label>
                  <Input
                    placeholder={t("coding.vercelProjectIdPlaceholder")}
                    value={vercelProjectIdInput}
                    onChange={(e) => setVercelProjectIdInput(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("coding.vercelProjectIdHint")}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-fit"
                onClick={handleSaveVercel}
                disabled={vercelSaving || (!vercelTokenInput.trim() && !vercelProjectIdInput.trim())}
              >
                {vercelSaving ? t("common.saving") : t("coding.vercelSaveConfig")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Boxes className="size-5 text-muted-foreground" />
                <CardTitle>{t("coding.githubCapabilitiesTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-1.5">
                  <Eye className="size-4 text-blue-500" />
                  {t("coding.githubCapReadWrite")}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("coding.githubCapReadWriteDesc")}
                </p>
              </div>
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-1.5">
                  <Rocket className="size-4 text-green-500" />
                  {t("coding.githubCapCommitPush")}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("coding.githubCapCommitPushDesc")}
                </p>
              </div>
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-1.5">
                  <GitBranch className="size-4 text-amber-500" />
                  {t("coding.githubCapRevert")}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("coding.githubCapRevertDesc")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "e2b" && (
        <div className="flex flex-col gap-6">
          {/* Configuration status card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="size-5 text-muted-foreground" />
                <CardTitle>{t("coding.e2bConfigTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {configured === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : configured ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3.5" />
                      {t("coding.e2bConfigured")}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestConnection}
                      disabled={testing}
                    >
                      {testing ? (
                        <>
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                          {t("coding.e2bTesting")}
                        </>
                      ) : (
                        t("coding.e2bTestConnection")
                      )}
                    </Button>
                  </div>
                  {/* Allow updating the key even when already configured */}
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1.5 flex-1 max-w-sm">
                      <Label className="text-xs text-muted-foreground">{t("coding.e2bUpdateKey")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.e2bKeyPlaceholder")}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveApiKey}
                      disabled={savingKey || !apiKeyInput.trim()}
                    >
                      {savingKey ? t("common.saving") : t("common.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3.5" />
                      {t("coding.e2bNotConfigured")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("coding.e2bConfigGuideInline")}
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1.5 flex-1 max-w-md">
                      <Label>{t("coding.e2bKeyLabel")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.e2bKeyPlaceholder")}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={handleSaveApiKey}
                      disabled={savingKey || !apiKeyInput.trim()}
                    >
                      {savingKey ? (
                        <>
                          <Loader2 className="mr-1.5 size-4 animate-spin" />
                          {t("common.saving")}
                        </>
                      ) : (
                        t("coding.e2bSaveKey")
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("coding.e2bKeyHint")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tutorial card (collapsible) */}
          <Card>
            <CardHeader className="p-0">
              <button
                type="button"
                className="flex w-full items-center justify-between p-6 text-left"
                aria-expanded={tutorialOpen}
                onClick={() => setTutorialOpen(!tutorialOpen)}
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="size-5 text-muted-foreground" />
                  <CardTitle>{t("coding.tutorialTitle")}</CardTitle>
                </div>
                {tutorialOpen ? (
                  <ChevronUp className="size-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-5 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {tutorialOpen && (
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <KeyRound className="size-4 text-primary" />
                    {t("coding.tutorialGetKey")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialGetKeyDesc")}
                  </p>
                  <a
                    href="https://e2b.dev/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    e2b.dev/dashboard <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-amber-500" />
                    {t("coding.tutorialHobbyLimits")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialHobbyLimitsDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <Globe className="size-4 text-blue-500" />
                    {t("coding.tutorialServerless")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialServerlessDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <Lightbulb className="size-4 text-yellow-500" />
                    {t("coding.tutorialUseCases")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialUseCasesDesc")}
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Code Playground */}
          {configured && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-5 text-muted-foreground" />
                    <div>
                      <CardTitle>{t("coding.playgroundTitle")}</CardTitle>
                      <CardDescription>{t("coding.playgroundDesc")}</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Language selector + run button */}
                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("coding.language")}</Label>
                    <Select
                      value={language}
                      onValueChange={(v) => handleLanguageChange(v as Language)}
                    >
                      <SelectTrigger id="coding-language-trigger" className="w-40">
                        {language === "python" ? t("coding.python") : language === "javascript" ? t("coding.javascript") : t("coding.html")}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="python">{t("coding.python")}</SelectItem>
                        <SelectItem value="javascript">{t("coding.javascript")}</SelectItem>
                        <SelectItem value="html">{t("coding.html")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleRunCode} disabled={running || !code.trim()}>
                    {running ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                        {t("coding.running")}
                      </>
                    ) : (
                      <>
                        <Play className="mr-1.5 size-4" />
                        {t("coding.runCode")}
                      </>
                    )}
                  </Button>
                </div>

                {/* Code editor */}
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full min-h-[200px] max-h-[400px] resize-y rounded-lg border bg-muted/30 p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />

                {/* Output */}
                {output && (
                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">{t("coding.output")}</h4>
                      <span className="text-xs text-muted-foreground">
                        {t("coding.executionTime", { ms: String(output.executionTimeMs) })}
                      </span>
                    </div>

                    {/* stdout */}
                    {output.stdout && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("coding.stdout")}</Label>
                        <pre className="rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto border">
                          {output.stdout}
                        </pre>
                      </div>
                    )}

                    {/* stderr / error */}
                    {(output.stderr || output.error) && (
                      <div className="space-y-1">
                        <Label className="text-xs text-destructive">{t("coding.stderr")}</Label>
                        <pre className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto text-destructive">
                          {output.error || output.stderr}
                        </pre>
                      </div>
                    )}

                    {/* Charts / Images */}
                    {output.results.some((r) => r.png) && (
                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1">
                          <ImageIcon className="size-3.5" />
                          {t("coding.artifacts")}
                        </Label>
                        <div className="flex flex-wrap gap-3">
                          {output.results
                            .filter((r) => r.png)
                            .map((r, i) => (
                              <NextImage
                                key={i}
                                src={`data:image/png;base64,${r.png!}`}
                                alt={`Chart ${i + 1}`}
                                width={1200}
                                height={800}
                                unoptimized
                                className="rounded-lg border max-w-full max-h-80 object-contain"
                              />
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Result text */}
                    {output.results.some((r) => r.text && !r.png) && (
                      <div className="space-y-1">
                        <pre className="rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto border">
                          {output.results
                            .filter((r) => r.text && !r.png)
                            .map((r) => r.text)
                            .join("\n")}
                        </pre>
                      </div>
                    )}

                    {/* HTML preview (local srcdoc) */}
                    {output.results.some((r) => r.html) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1">
                            <Globe className="size-3.5" />
                            {t("coding.preview")}
                          </Label>
                          {output.previewUrl && (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={output.previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="size-3" />
                                {t("coding.openPreview")}
                              </a>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5"
                                onClick={() => {
                                  navigator.clipboard.writeText(output.previewUrl!);
                                  toast.success(t("coding.previewLinkCopied"));
                                }}
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <iframe
                          srcDoc={output.results.find((r) => r.html)?.html}
                          className="w-full h-80 rounded-lg border bg-white"
                          sandbox="allow-scripts"
                          title="HTML Preview"
                        />
                      </div>
                    )}

                    {/* No output at all */}
                    {!output.stdout &&
                      !output.stderr &&
                      !output.error &&
                      output.results.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("coding.noOutput")}</p>
                      )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Use Case Gallery (collapsible) */}
          <Card>
            <CardHeader className="p-0">
              <button
                type="button"
                className="flex w-full items-center justify-between p-6 text-left"
                aria-expanded={useCasesOpen}
                onClick={() => setUseCasesOpen(!useCasesOpen)}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="size-5 text-muted-foreground" />
                  <div>
                    <CardTitle>{t("coding.useCasesTitle")}</CardTitle>
                    {useCasesOpen && (
                      <CardDescription className="mt-1">{t("coding.useCasesSubtitle")}</CardDescription>
                    )}
                  </div>
                </div>
                {useCasesOpen ? (
                  <ChevronUp className="size-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-5 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {useCasesOpen && (
              <CardContent className="space-y-8">
                {useCaseCategories.map((cat) => (
                  <div key={cat.titleKey}>
                    <h3 className="text-sm font-semibold mb-3 text-foreground/80">
                      {t(cat.titleKey as Parameters<typeof t>[0])}
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cat.cases.map((uc) => {
                        const Icon = uc.icon;
                        const toolKey = `coding.toolBadge${uc.tool === "python" ? "Python" : uc.tool === "js" ? "JS" : uc.tool === "html" ? "HTML" : "Multi"}` as const;
                        const badgeVariant = uc.tool === "python" ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950"
                          : uc.tool === "js" ? "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950"
                          : uc.tool === "html" ? "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950"
                          : "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950";

                        return (
                          <div
                            key={uc.title}
                            className="group rounded-lg border p-4 space-y-2.5 hover:border-primary/30 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-medium text-sm flex items-center gap-1.5">
                                <Icon className={`size-4 shrink-0 ${uc.iconColor}`} />
                                {uc.title}
                              </h4>
                              <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeVariant}`}>
                                {t(toolKey as Parameters<typeof t>[0])}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {uc.desc}
                            </p>
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 opacity-70 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  navigator.clipboard.writeText(uc.prompt);
                                  toast.success(t("coding.promptCopied"));
                                }}
                              >
                                <Copy className="size-3" />
                                {t("coding.copyPrompt")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
