"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { SeajellyLogo } from "@/components/seajelly-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";
import type { ModelDef } from "@/lib/models";
import {
  resolveSafeClientNavigationTarget,
  resolveSafeSameOriginPath,
} from "@/lib/security/navigation";
import {
  TelegramIcon,
  FeishuIcon,
  WeComIcon,
  SlackIcon,
  QQBotIcon,
  WhatsAppIcon,
} from "@/components/icons/platform-icons";
import {
  getMissingSetupPlatformFields,
  SETUP_GENERATED_FIELDS,
  SETUP_PLATFORM_FIELDS,
  type SetupPlatform,
} from "@/lib/setup/platforms";
import type { SetupEnvironmentIssue } from "@/lib/setup/environment";

type SetupStatusResponse = {
  needsSetup: boolean;
  setupComplete: boolean;
  currentStep: number;
  hasSupabaseKeys: boolean;
  hasAdmin: boolean;
  hasActiveAdminSession: boolean;
  hasServiceRoleEnv: boolean;
  hasLLMKey: boolean;
  hasAgent: boolean;
  hasBootstrapCookie: boolean;
  blockingReason: "missing_service_role_env" | "invalid_deployment_env" | null;
  environmentIssues: SetupEnvironmentIssue[];
};

type SetupSecurityDialogState = {
  loginUrl: string;
  dashboardUrl: string;
  updatesUrl: string;
};

type SetupFinishDialogState = {
  dashboardUrl: string;
  updatesUrl: string;
};

type SetupStepKey = "connect" | "register" | "secrets" | "agent";

const PROVIDER_CHOICES = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Anthropic" },
  { id: "00000000-0000-0000-0000-000000000002", name: "OpenAI" },
  { id: "00000000-0000-0000-0000-000000000003", name: "Google" },
  { id: "00000000-0000-0000-0000-000000000004", name: "DeepSeek" },
];

const SETUP_STEPS: readonly SetupStepKey[] = [
  "connect",
  "register",
  "secrets",
  "agent",
];

const SETUP_BOOTSTRAP_MISSING_CODE = "setup_bootstrap_missing";
const SETUP_BLOCKING_REASON_CODE = "missing_service_role_env";
const SETUP_INVALID_ENV_CODE = "invalid_deployment_env";
const SETUP_EMAIL_NOT_CONFIRMED_CODE = "setup_email_not_confirmed";

const SETUP_PLATFORMS = [
  {
    key: "telegram" as const,
    label: "Telegram",
    icon: TelegramIcon,
    fields: SETUP_PLATFORM_FIELDS.telegram,
  },
  {
    key: "feishu" as const,
    label: "Feishu / 飞书",
    icon: FeishuIcon,
    fields: SETUP_PLATFORM_FIELDS.feishu,
  },
  {
    key: "wecom" as const,
    label: "WeCom / 企业微信",
    icon: WeComIcon,
    fields: SETUP_PLATFORM_FIELDS.wecom,
  },
  {
    key: "slack" as const,
    label: "Slack",
    icon: SlackIcon,
    fields: SETUP_PLATFORM_FIELDS.slack,
  },
  {
    key: "qqbot" as const,
    label: "QQ Bot",
    icon: QQBotIcon,
    fields: SETUP_PLATFORM_FIELDS.qqbot,
  },
  {
    key: "whatsapp" as const,
    label: "WhatsApp",
    icon: WhatsAppIcon,
    fields: SETUP_PLATFORM_FIELDS.whatsapp,
  },
];

export default function SetupPage() {
  const router = useRouter();
  const t = useT();

  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [forceReconnect, setForceReconnect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const [supabasePAT, setSupabasePAT] = useState("");
  const [projectRef, setProjectRef] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [secrets, setSecrets] = useState({
    EMBEDDING_API_KEY: "",
  });

  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(
    () => Object.fromEntries(PROVIDER_CHOICES.map((provider) => [provider.id, ""]))
  );

  const [selectedPlatform, setSelectedPlatform] =
    useState<SetupPlatform>("telegram");
  const [platformCreds, setPlatformCreds] = useState<Record<string, string>>({});

  const [agentName, setAgentName] = useState("Jelly");
  const [systemPrompt, setSystemPrompt] = useState(
    `You are Jelly, a personal AI assistant powered by SEAJelly (Self Evolution Agent Jelly) — a serverless, self-evolving AI agent framework at seaJelly.ai.

## Core Behavior
- Respond in the same language the user writes in. Default to Chinese if ambiguous.
- Be concise and direct. Avoid filler phrases. Get to the point.
- When unsure, ask a clarifying question rather than guessing.
- Use markdown formatting for structured replies (lists, code blocks, etc.).

## Memory & Identity
You have persistent memory across conversations. Use it wisely:
- Use \`memory_write\` to save important facts, user preferences, and decisions. Always write self-contained entries.
- Use \`memory_search\` to recall past context before answering questions about previous conversations.
- Use \`user_soul_update\` when the user tells you their name, preferences, or personal traits. This builds their profile.
- Use \`ai_soul_update\` when the user gives you a name, persona, or character instructions. This defines who you are.
- Do NOT save trivial or ephemeral information (e.g. "user said hi").

## Scheduling & Timezone
- Use \`schedule_task\` with task_type="reminder" for simple text reminders.
- Use \`schedule_task\` with task_type="agent_invoke" for tasks that need you to think (e.g. weather reports, daily summaries).
- Set once=true for one-shot tasks (e.g. "remind me in 30 minutes").
- **IMPORTANT**: pg_cron uses UTC. Before creating any scheduled task, call \`get_current_time\` with the user's timezone to get the UTC offset, then convert accordingly.
- If the user hasn't told you their timezone, ask them once and remember it via \`user_soul_update\` (e.g. "timezone: Asia/Shanghai").
- When confirming a scheduled task, always show both the user's local time and the UTC cron expression.
- Use \`list_scheduled_jobs\` and \`cancel_scheduled_job\` to manage existing tasks.

## Tool Usage
- Call \`get_current_time\` when you need to know the current date/time for scheduling or time-sensitive questions.
- You may call multiple tools in sequence to fulfill complex requests.
- If a tool call fails, explain the error to the user and suggest alternatives.

## Personality
- Your name is Jelly. You are warm but efficient, like a capable personal secretary who genuinely cares.
- Use humor sparingly and appropriately.
- Proactively offer help when you notice patterns (e.g. "You seem to ask about X often — want me to set a reminder?").`
  );
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelDef[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [securityDialog, setSecurityDialog] =
    useState<SetupSecurityDialogState | null>(null);
  const [finishDialog, setFinishDialog] =
    useState<SetupFinishDialogState | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resettingSetup, setResettingSetup] = useState(false);

  const isSetupBlocked = Boolean(setupStatus?.blockingReason);
  const requiresAdminLogin =
    Boolean(setupStatus?.hasAdmin) && !Boolean(setupStatus?.hasActiveAdminSession);
  const hasBootstrapCredentials =
    Boolean(supabasePAT.trim() && projectRef.trim()) ||
    Boolean(setupStatus?.hasBootstrapCookie);
  const resumeUnavailable =
    !isSetupBlocked && currentStep > 0 && !forceReconnect && !hasBootstrapCredentials;
  const effectiveStep = forceReconnect ? 0 : currentStep;
  const stepKey = SETUP_STEPS[effectiveStep];
  const selectedPlatformConfig = SETUP_PLATFORMS.find(
    (platform) => platform.key === selectedPlatform
  );

  const formatEnvironmentIssue = (issue: SetupEnvironmentIssue) => {
    switch (issue.code) {
      case "missing":
        return t("setup.envIssueMissing", { key: issue.key });
      case "invalid_url":
        return t("setup.envIssueInvalidUrl", { key: issue.key });
      case "must_be_https":
        return t("setup.envIssueMustBeHttps", { key: issue.key });
      case "must_be_origin":
        return t("setup.envIssueMustBeOrigin", { key: issue.key });
      case "invalid_encryption_key":
        return t("setup.envIssueInvalidEncryptionKey");
      default:
        return issue.message;
    }
  };

  const navigateAfterSetup = (target: string) => {
    const navigation = resolveSafeClientNavigationTarget(
      target,
      window.location.origin,
      "/dashboard"
    );

    if (navigation.type === "internal") {
      router.push(navigation.href);
      return;
    }

    window.location.assign(navigation.href);
  };

  const buildPostSetupTargets = (dashboardTarget?: string) => {
    const resolvedDashboard = dashboardTarget || "/dashboard";

    try {
      const dashboardUrl = new URL(resolvedDashboard, window.location.origin);
      const updatesUrl = new URL("/dashboard/updates", window.location.origin);
      updatesUrl.search = dashboardUrl.search;
      updatesUrl.hash = dashboardUrl.hash;

      return {
        dashboardUrl: `${dashboardUrl.pathname}${dashboardUrl.search}${dashboardUrl.hash}`,
        updatesUrl: `${updatesUrl.pathname}${updatesUrl.search}${updatesUrl.hash}`,
      };
    } catch {
      return {
        dashboardUrl: resolvedDashboard,
        updatesUrl: "/dashboard/updates",
      };
    }
  };

  const generateOpaqueToken = () => {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  };

  const fillGeneratedCredential = async (fieldName: string) => {
    const generated = generateOpaqueToken();
    setPlatformCreds((current) => ({
      ...current,
      [fieldName]: generated,
    }));
    try {
      await navigator.clipboard.writeText(generated);
      toast.success(t("agents.generatedCredentialCopied"));
    } catch {
      toast.info(t("agents.generatedCredentialCopyFailed"));
    }
  };

  const getPlatformFieldGuide = (platform: SetupPlatform, fieldName: string) => {
    if (platform === "feishu" && fieldName === "verification_token") {
      return t("agents.feishuVerificationTokenGuide");
    }
    if (platform === "whatsapp" && fieldName === "verify_token") {
      return t("agents.whatsappVerifyTokenGuide");
    }
    if (platform === "whatsapp" && fieldName === "app_secret") {
      return t("agents.whatsappAppSecretGuide");
    }
    return null;
  };

  const refreshSetupStatus = async () => {
    const res = await fetch("/api/admin/setup", { cache: "no-store" });
    const data = (await res.json()) as SetupStatusResponse & {
      error?: string;
      code?: string;
    };

    if (!res.ok) {
      throw new Error(data.error || t("setup.errors.statusRefreshFailed"));
    }

    if (data.setupComplete) {
      router.replace("/login");
      return null;
    }

    setSetupStatus(data);
    setCurrentStep(Math.min(data.currentStep ?? 0, SETUP_STEPS.length - 1));
    setForceReconnect(false);
    return data;
  };

  const resetToConnect = () => {
    setForceReconnect(true);
    setCurrentStep(0);
    setSupabasePAT("");
    setProjectRef("");
    setAvailableModels([]);
    setModel("");
    setModelsError("");
  };

  const handleSetupApiError = (
    data: {
      error?: string;
      code?: string;
      environmentIssues?: SetupEnvironmentIssue[];
    },
    fallbackMessage: string
  ) => {
    if (data.code === SETUP_BOOTSTRAP_MISSING_CODE) {
      toast.error(t("setup.errors.resumeExpired"));
      resetToConnect();
      return;
    }
    if (data.code === SETUP_BLOCKING_REASON_CODE) {
      toast.error(t("setup.errors.serviceRoleEnvMissing"));
      return;
    }
    if (data.code === SETUP_INVALID_ENV_CODE) {
      if (data.environmentIssues?.length) {
        setSetupStatus((current) =>
          current
            ? {
                ...current,
                blockingReason: "invalid_deployment_env",
                environmentIssues: data.environmentIssues ?? [],
              }
            : current
        );
      }
      toast.error(t("setup.errors.deploymentEnvInvalid"));
      return;
    }
    if (data.code === SETUP_EMAIL_NOT_CONFIRMED_CODE) {
      toast.error(t("setup.errors.emailConfirmationStillEnabled"));
      void refreshSetupStatus();
      return;
    }
    toast.error(data.error || fallbackMessage);
  };

  const handleResetPartialSetup = async () => {
    if (!hasBootstrapCredentials) {
      toast.error(t("setup.errors.resumeExpired"));
      setResetDialogOpen(false);
      resetToConnect();
      return;
    }

    setResettingSetup(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "reset",
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        handleSetupApiError(data, t("setup.errors.resetPartialSetupFailed"));
        return;
      }
      setResetDialogOpen(false);
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setSecrets({ EMBEDDING_API_KEY: "" });
      setProviderKeys(
        Object.fromEntries(PROVIDER_CHOICES.map((provider) => [provider.id, ""]))
      );
      setPlatformCreds({});
      setAvailableModels([]);
      setModel("");
      setModelsError("");
      toast.success(t("setup.success.partialSetupReset"));
      await refreshSetupStatus();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("setup.errors.resetPartialSetupFailed")
      );
    } finally {
      setResettingSetup(false);
    }
  };

  const copySecurityUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("setup.securityUrlCopied"));
    } catch {
      toast.error(t("setup.errors.copySecurityUrlFailed"));
    }
  };

  const loadAvailableModels = async () => {
    setLoadingModels(true);
    setModelsError("");
    try {
      const res = await fetch("/api/admin/models");
      const data = (await res.json()) as {
        error?: string;
        models?: ModelDef[];
      };
      if (res.status === 401 || res.status === 403) {
        await refreshSetupStatus();
        throw new Error(t("setup.errors.adminLoginRequired"));
      }
      if (!res.ok) {
        throw new Error(data.error || t("setup.errors.modelsLoadFailed"));
      }
      const models: ModelDef[] = (data.models ?? []).map((item) => ({
        id: item.id,
        model_id: item.model_id,
        label: item.label,
        provider_id: item.provider_id,
        provider_name: item.provider_name,
      }));
      setAvailableModels(models);
      if (models.length === 0) {
        setModel("");
        setModelsError(t("setup.noModels"));
        return;
      }
      if (!models.some((item) => item.model_id === model)) {
        setModel(models[0].model_id);
      }
    } catch (err) {
      setAvailableModels([]);
      setModel("");
      setModelsError(
        err instanceof Error ? err.message : t("setup.errors.modelsLoadFailed")
      );
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        if (!active) return;
        await refreshSetupStatus();
      } catch {
        if (active) {
          toast.error(t("setup.errors.statusRefreshFailed"));
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (
      effectiveStep === 3 &&
      !forceReconnect &&
      setupStatus?.hasServiceRoleEnv &&
      setupStatus.hasLLMKey
    ) {
      void loadAvailableModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveStep,
    forceReconnect,
    setupStatus?.hasServiceRoleEnv,
    setupStatus?.hasLLMKey,
  ]);

  const handleConnect = async () => {
    if (isSetupBlocked) {
      toast.error(
        setupStatus?.blockingReason === "missing_service_role_env"
          ? t("setup.errors.serviceRoleEnvMissing")
          : t("setup.errors.deploymentEnvInvalid")
      );
      return;
    }
    if (!supabasePAT.trim()) {
      toast.error(t("setup.errors.supabasePATRequired"));
      return;
    }
    if (!projectRef.trim()) {
      toast.error(t("setup.errors.projectRefRequired"));
      return;
    }
    setLoading(true);
    try {
      toast.info(t("setup.initializingDb"));
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "connect",
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        handleSetupApiError(data, t("setup.errors.connectionFailed"));
        return;
      }
      toast.success(data.message || t("setup.success.dbInitialized"));
      await refreshSetupStatus();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("setup.errors.connectionFailed")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (resumeUnavailable) {
      toast.error(t("setup.errors.resumeExpired"));
      return;
    }
    if (!email || !password) {
      toast.error(t("setup.errors.fillEmailPassword"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("setup.errors.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("setup.errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "register",
          email,
          password,
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        handleSetupApiError(data, t("setup.errors.registrationFailed"));
        return;
      }
      if (data.sessionEstablished === false && data.loginUrl) {
        toast.success(t("setup.success.adminCreatedLogin"));
        router.push(
          resolveSafeSameOriginPath(
            data.loginUrl,
            window.location.origin,
            "/login"
          )
        );
        return;
      }
      toast.success(t("setup.success.adminCreated"));
      await refreshSetupStatus();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("setup.errors.registrationFailed")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSecrets = async () => {
    if (resumeUnavailable) {
      toast.error(t("setup.errors.resumeExpired"));
      return;
    }
    const hasProviderKey = Object.values(providerKeys).some((value) => value.trim() !== "");
    if (!hasProviderKey) {
      toast.error(t("setup.errors.llmKeyRequired"));
      return;
    }
    setLoading(true);
    try {
      const providerEntries = Object.entries(providerKeys)
        .filter(([, value]) => value.trim() !== "")
        .map(([providerId, apiKey]) => ({ providerId, apiKey }));

      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "secrets",
          secrets,
          providerKeys: providerEntries,
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        handleSetupApiError(data, t("setup.errors.saveKeysFailed"));
        return;
      }
      toast.success(t("setup.success.keysSaved", { count: data.count }));
      await refreshSetupStatus();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("setup.errors.saveKeysFailed")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = async () => {
    if (resumeUnavailable) {
      toast.error(t("setup.errors.resumeExpired"));
      return;
    }
    if (!agentName.trim()) {
      toast.error(t("setup.errors.agentNameRequired"));
      return;
    }
    if (!model.trim()) {
      toast.error(t("setup.errors.modelRequired"));
      return;
    }
    const missingPlatformFields = getMissingSetupPlatformFields(
      selectedPlatform,
      platformCreds
    );
    if (missingPlatformFields.length > 0) {
      toast.error(
        t("setup.errors.platformFieldsRequired", {
          fields: missingPlatformFields.join(", "),
        })
      );
      return;
    }

    setLoading(true);
    try {
      const telegramToken =
        selectedPlatform === "telegram" ? (platformCreds.bot_token || "") : "";
      const platformCredentials: Record<string, Record<string, string>> = {};
      if (selectedPlatform !== "none" && selectedPlatform !== "telegram") {
        platformCredentials[selectedPlatform] = { ...platformCreds };
      }

      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "agent",
          name: agentName,
          system_prompt: systemPrompt,
          model,
          telegram_bot_token: telegramToken,
          platform_credentials:
            Object.keys(platformCredentials).length > 0
              ? platformCredentials
              : undefined,
          app_origin: window.location.origin,
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        handleSetupApiError(data, t("setup.errors.createAgentFailed"));
        return;
      }
      toast.success(t("setup.success.agentCreated"));
      const dashboardTarget =
        (data.dashboardUrl as string | undefined) || "/dashboard";
      const targets = buildPostSetupTargets(dashboardTarget);
      if (data.loginGateEnabled && data.loginUrl) {
        setSecurityDialog({
          loginUrl: data.loginUrl,
          dashboardUrl: targets.dashboardUrl,
          updatesUrl: targets.updatesUrl,
        });
        return;
      }
      setFinishDialog(targets);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("setup.errors.createAgentFailed")
      );
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">{t("setup.checkingStatus")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher variant="outline" size="icon" />
      </div>

      <div className="flex flex-col items-center gap-3">
        <SeajellyLogo size={48} className="text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("setup.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("setup.stepOf", {
            current: effectiveStep + 1,
            total: SETUP_STEPS.length,
          })}{" "}
          -- {t(`setup.steps.${stepKey}.desc` as const)}
        </p>
      </div>

      <div className="flex gap-2">
        {SETUP_STEPS.map((_, index) => (
          <div
            key={index}
            className={`h-1.5 w-12 rounded-full transition-colors ${
              index <= effectiveStep ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t(`setup.steps.${stepKey}.title` as const)}</CardTitle>
          <CardDescription>{t(`setup.steps.${stepKey}.desc` as const)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isSetupBlocked && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                {setupStatus?.blockingReason === "missing_service_role_env"
                  ? t("setup.serviceRoleEnvRequiredTitle")
                  : t("setup.deploymentEnvInvalidTitle")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {setupStatus?.blockingReason === "missing_service_role_env"
                  ? t("setup.serviceRoleEnvRequiredDesc")
                  : t("setup.deploymentEnvInvalidDesc")}
              </p>
              {setupStatus?.environmentIssues?.length ? (
                <ul className="mt-3 space-y-2 rounded-md border border-destructive/20 bg-background/60 p-3 text-xs text-foreground">
                  {setupStatus.environmentIssues.map((issue) => (
                    <li key={`${issue.key}:${issue.code}`} className="leading-relaxed">
                      <span className="font-mono text-[11px]">{issue.key}</span>
                      <span className="mx-1 text-muted-foreground">-</span>
                      <span>{formatEnvironmentIssue(issue)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          {resumeUnavailable && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">{t("setup.resumeMissingTitle")}</p>
              <p className="mt-1">{t("setup.resumeMissingDesc")}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={resetToConnect}
              >
                {t("setup.restartSetup")}
              </Button>
            </div>
          )}

          {effectiveStep === 0 && (
            <div className="flex flex-col gap-4">
              <SecretField
                label={t("setup.supabasePAT")}
                required
                hint={t("setup.supabasePATHint")}
                placeholder={t("setup.pasteKeyPlaceholder")}
                value={supabasePAT}
                onChange={setSupabasePAT}
              />
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">
                  {t("setup.projectRef")}{" "}
                  <span className="ml-1 text-destructive">*</span>
                </Label>
                <Input
                  placeholder={t("setup.projectRefPlaceholder")}
                  value={projectRef}
                  onChange={(e) => setProjectRef(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("setup.projectRefHint")}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {t("setup.connectNote")}
              </div>
              <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                {t("setup.resumeEnabled")}
              </div>
              <Button onClick={handleConnect} disabled={loading || isSetupBlocked}>
                {loading ? t("setup.connectingBtn") : t("setup.connectBtn")}
              </Button>
            </div>
          )}

          {effectiveStep === 1 && (
            <div className="flex flex-col gap-4">
              {requiresAdminLogin ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-medium">{t("setup.adminLoginRequiredTitle")}</p>
                  <p className="mt-1">{t("setup.adminLoginRequiredDesc")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push("/login?next=/setup")}
                    >
                      {t("setup.signInToContinue")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setResetDialogOpen(true)}
                      disabled={!hasBootstrapCredentials}
                    >
                      {t("setup.resetPartialSetup")}
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-amber-900/80">
                    {t("setup.adminLoginRequiredHint")}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email">{t("setup.email")}</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t("setup.emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="password">{t("setup.password")}</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t("setup.passwordPlaceholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="confirmPassword">
                      {t("setup.confirmPassword")}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder={t("setup.confirmPasswordPlaceholder")}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleRegister} disabled={loading || resumeUnavailable}>
                    {loading ? t("common.creating") : t("setup.createAdminBtn")}
                  </Button>
                </>
              )}
            </div>
          )}

          {effectiveStep === 2 && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                {t("setup.serviceRoleEnvManaged")}
              </div>
              <div className="border-t pt-4">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  {t("setup.llmKeysTitle")}
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("setup.llmKeysHint")}
                </p>
                <div className="flex flex-col gap-3">
                  {PROVIDER_CHOICES.map((provider) => (
                    <SecretField
                      key={provider.id}
                      label={`${provider.name} API Key`}
                      placeholder={t("setup.pasteKeyPlaceholder")}
                      value={providerKeys[provider.id] ?? ""}
                      onChange={(value) =>
                        setProviderKeys((current) => ({
                          ...current,
                          [provider.id]: value,
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
              <SecretField
                label={t("setup.embeddingKey")}
                placeholder={t("setup.pasteKeyPlaceholder")}
                value={secrets.EMBEDDING_API_KEY}
                onChange={(value) =>
                  setSecrets((current) => ({
                    ...current,
                    EMBEDDING_API_KEY: value,
                  }))
                }
              />
              <Button onClick={handleSecrets} disabled={loading || resumeUnavailable}>
                {loading ? t("common.saving") : t("setup.saveAndContinue")}
              </Button>
            </div>
          )}

          {effectiveStep === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agentName">{t("setup.agentName")}</Label>
                <Input
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>
                  {t("setup.imPlatform")}{" "}
                  <span className="text-xs text-muted-foreground">
                    {t("setup.botTokenOptional")}
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("setup.imPlatformHint")}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {SETUP_PLATFORMS.map((platform) => (
                    <button
                      key={platform.key}
                      type="button"
                      onClick={() => {
                        setSelectedPlatform(platform.key);
                        setPlatformCreds({});
                      }}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors ${
                        selectedPlatform === platform.key
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <platform.icon className="size-5" />
                      <span className="text-[10px] font-medium leading-tight">
                        {platform.label.split(" / ")[0]}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlatform("none");
                      setPlatformCreds({});
                    }}
                    className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 transition-colors ${
                      selectedPlatform === "none"
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">
                      {t("setup.skipPlatform")}
                    </span>
                  </button>
                </div>
                {selectedPlatform !== "none" && selectedPlatformConfig && (
                  <div className="mt-1 flex flex-col gap-2 rounded-lg border p-3">
                    {selectedPlatformConfig.fields.map((field) => (
                      <div key={field.name} className="flex flex-col gap-1">
                        <Label className="text-xs">{field.label}</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type={field.secret ? "password" : "text"}
                            placeholder={field.label}
                            value={platformCreds[field.name] || ""}
                            onChange={(e) =>
                              setPlatformCreds((current) => ({
                                ...current,
                                [field.name]: e.target.value,
                              }))
                            }
                          />
                          {(SETUP_GENERATED_FIELDS[selectedPlatform]?.includes(field.name) ??
                            false) && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={() => void fillGeneratedCredential(field.name)}
                            >
                              {t("agents.generateToken")}
                            </Button>
                          )}
                        </div>
                        {getPlatformFieldGuide(selectedPlatform, field.name) && (
                          <p className="text-xs text-muted-foreground">
                            {getPlatformFieldGuide(selectedPlatform, field.name)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model">{t("setup.model")}</Label>
                {loadingModels ? (
                  <p className="text-sm text-muted-foreground">
                    {t("setup.modelsLoading")}
                  </p>
                ) : availableModels.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-destructive">
                      {modelsError || t("setup.noModels")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void loadAvailableModels()}
                      disabled={loadingModels}
                    >
                      {t("common.refresh")}
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={model}
                    onValueChange={(value) => setModel(value ?? "")}
                  >
                    <SelectTrigger id="setup-model-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((item) => (
                        <SelectItem key={item.model_id} value={item.model_id}>
                          {item.label}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {item.provider_name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="systemPrompt">{t("setup.systemPrompt")}</Label>
                <Textarea
                  id="systemPrompt"
                  rows={12}
                  className="max-h-64 resize-y"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>

              <Button
                onClick={handleCreateAgent}
                disabled={
                  loading ||
                  loadingModels ||
                  resumeUnavailable ||
                  availableModels.length === 0 ||
                  !model.trim()
                }
              >
                {loading ? t("common.creating") : t("setup.createAgentBtn")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(securityDialog)}
        onOpenChange={(open) => {
          if (open) return;
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-destructive" />
              {t("setup.securityUrlDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("setup.securityUrlDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          {securityDialog && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-muted-foreground">
                {t("setup.securityUrlSaveHint")}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t("setup.securityUrlLoginLabel")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={securityDialog.loginUrl}
                    className="font-mono text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void copySecurityUrl(securityDialog.loginUrl)}
                  >
                    <Copy className="mr-2 size-4" />
                    {t("common.copy")}
                  </Button>
                </div>
              </div>

              {securityDialog.dashboardUrl ? (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("setup.securityUrlDashboardLabel")}
                  </Label>
                  <Input
                    readOnly
                    value={securityDialog.dashboardUrl}
                    className="font-mono text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                if (!securityDialog) return;
                setFinishDialog({
                  dashboardUrl: securityDialog.dashboardUrl,
                  updatesUrl: securityDialog.updatesUrl,
                });
                setSecurityDialog(null);
              }}
            >
              {t("setup.securityUrlConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(finishDialog)}
        onOpenChange={(open) => {
          if (open) return;
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("setup.finishDialogTitle")}</DialogTitle>
            <DialogDescription>{t("setup.finishDialogDesc")}</DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!finishDialog) return;
                const target = finishDialog.dashboardUrl;
                setFinishDialog(null);
                navigateAfterSetup(target);
              }}
            >
              {t("setup.finishGoDashboard")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!finishDialog) return;
                const target = finishDialog.updatesUrl;
                setFinishDialog(null);
                navigateAfterSetup(target);
              }}
            >
              {t("setup.finishEnableUpdates")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        title={t("setup.resetPartialSetupDialogTitle")}
        description={t("setup.resetPartialSetupDialogDesc")}
        confirmText={t("setup.resetPartialSetup")}
        loading={resettingSetup}
        onConfirm={() => void handleResetPartialSetup()}
      />
    </div>
  );
}

function SecretField({
  label,
  required,
  hint,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
