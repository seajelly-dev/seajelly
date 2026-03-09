"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import { CrabLogo } from "@/components/crab-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";
import { getAvailableModels } from "@/lib/models";

export default function SetupPage() {
  const router = useRouter();
  const t = useT();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const [supabasePAT, setSupabasePAT] = useState("");
  const [projectRef, setProjectRef] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [secrets, setSecrets] = useState({
    SUPABASE_SERVICE_ROLE_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    EMBEDDING_API_KEY: "",
  });

  const [agentName, setAgentName] = useState("Crab");
  const [systemPrompt, setSystemPrompt] = useState(
    `You are a personal AI assistant running on the OpenCrab framework.

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
- Warm but efficient. Think of yourself as a capable personal secretary.
- Use humor sparingly and appropriately.
- Proactively offer help when you notice patterns (e.g. "You seem to ask about X often -- want me to set a reminder?").`
  );
  const [model, setModel] = useState("");
  const [botToken, setBotToken] = useState("");
  const [availableModels, setAvailableModels] = useState<
    ReturnType<typeof getAvailableModels>
  >([]);

  const STEPS_KEYS = ["connect", "register", "secrets", "agent"] as const;

  const loadAvailableModels = (keys: string[]) => {
    const models = getAvailableModels(new Set(keys));
    setAvailableModels(models);
    if (models.length > 0 && !model) {
      setModel(models[0].id);
    }
  };

  useEffect(() => {
    fetch("/api/admin/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data.setupComplete) {
          router.replace("/login");
          return;
        }
        setCurrentStep(Math.min(data.currentStep ?? 0, 3));
        if (data.configuredKeys) {
          loadAvailableModels(data.configuredKeys);
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleConnect = async () => {
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
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message || t("setup.success.dbInitialized"));
      setCurrentStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("setup.errors.connectionFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
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
      if (!res.ok) throw new Error(data.error);
      toast.success(t("setup.success.adminCreated"));
      setCurrentStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("setup.errors.registrationFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSecrets = async () => {
    if (!secrets.SUPABASE_SERVICE_ROLE_KEY) {
      toast.error(t("setup.errors.serviceRoleRequired"));
      return;
    }
    const hasLLMKey =
      secrets.OPENAI_API_KEY ||
      secrets.ANTHROPIC_API_KEY ||
      secrets.GOOGLE_GENERATIVE_AI_API_KEY ||
      secrets.DEEPSEEK_API_KEY;
    if (!hasLLMKey) {
      toast.error(t("setup.errors.llmKeyRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "secrets",
          secrets,
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("setup.success.keysSaved", { count: data.count }));
      const filledKeys = Object.entries(secrets)
        .filter(([, v]) => v.trim() !== "")
        .map(([k]) => k);
      loadAvailableModels(filledKeys);
      setCurrentStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("setup.errors.saveKeysFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      toast.error(t("setup.errors.agentNameRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "agent",
          name: agentName,
          system_prompt: systemPrompt,
          model,
          telegram_bot_token: botToken,
          app_origin: window.location.origin,
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(t("setup.success.agentCreated"));
      if (data.loginGateEnabled && data.loginUrl) {
        window.alert(
          t("setup.loginGateWarning", {
            url: data.loginUrl,
          })
        );
      }
      const nextUrl =
        (data.loginUrl as string | undefined) ||
        (data.dashboardUrl as string | undefined) ||
        "/dashboard";
      setTimeout(() => router.push(nextUrl), 200);
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

  const stepKey = STEPS_KEYS[currentStep];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher variant="outline" size="icon" />
      </div>

      <div className="flex flex-col items-center gap-3">
        <CrabLogo size={48} className="text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("setup.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("setup.stepOf", { current: currentStep + 1, total: STEPS_KEYS.length })} -- {t(`setup.steps.${stepKey}.desc` as const)}
        </p>
      </div>

      <div className="flex gap-2">
        {STEPS_KEYS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-12 rounded-full transition-colors ${
              i <= currentStep ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t(`setup.steps.${stepKey}.title` as const)}</CardTitle>
          <CardDescription>{t(`setup.steps.${stepKey}.desc` as const)}</CardDescription>
        </CardHeader>
        <CardContent>
          {currentStep === 0 && (
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
              <Button onClick={handleConnect} disabled={loading}>
                {loading ? t("setup.connectingBtn") : t("setup.connectBtn")}
              </Button>
            </div>
          )}

          {currentStep === 1 && (
            <div className="flex flex-col gap-4">
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
                <Label htmlFor="confirmPassword">{t("setup.confirmPassword")}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t("setup.confirmPasswordPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={handleRegister} disabled={loading}>
                {loading ? t("common.creating") : t("setup.createAdminBtn")}
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="flex flex-col gap-4">
              <SecretField
                label={t("setup.serviceRoleKey")}
                required
                hint={t("setup.serviceRoleKeyHint")}
                placeholder={t("setup.pasteKeyPlaceholder")}
                value={secrets.SUPABASE_SERVICE_ROLE_KEY}
                onChange={(v) =>
                  setSecrets((s) => ({ ...s, SUPABASE_SERVICE_ROLE_KEY: v }))
                }
              />
              <div className="border-t pt-4">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  {t("setup.llmKeysTitle")}
                </p>
                <div className="flex flex-col gap-3">
                  <SecretField
                    label={t("setup.anthropicKey")}
                    placeholder={t("setup.pasteKeyPlaceholder")}
                    value={secrets.ANTHROPIC_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, ANTHROPIC_API_KEY: v }))
                    }
                  />
                  <SecretField
                    label={t("setup.openaiKey")}
                    placeholder={t("setup.pasteKeyPlaceholder")}
                    value={secrets.OPENAI_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, OPENAI_API_KEY: v }))
                    }
                  />
                  <SecretField
                    label={t("setup.googleKey")}
                    placeholder={t("setup.pasteKeyPlaceholder")}
                    value={secrets.GOOGLE_GENERATIVE_AI_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({
                        ...s,
                        GOOGLE_GENERATIVE_AI_API_KEY: v,
                      }))
                    }
                  />
                  <SecretField
                    label={t("setup.deepseekKey")}
                    placeholder={t("setup.pasteKeyPlaceholder")}
                    value={secrets.DEEPSEEK_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, DEEPSEEK_API_KEY: v }))
                    }
                  />
                </div>
              </div>
              <SecretField
                label={t("setup.embeddingKey")}
                placeholder={t("setup.pasteKeyPlaceholder")}
                value={secrets.EMBEDDING_API_KEY}
                onChange={(v) =>
                  setSecrets((s) => ({ ...s, EMBEDDING_API_KEY: v }))
                }
              />
              <Button onClick={handleSecrets} disabled={loading}>
                {loading ? t("common.saving") : t("setup.saveAndContinue")}
              </Button>
            </div>
          )}

          {currentStep === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agentName">{t("setup.agentName")}</Label>
                <Input
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="botToken">
                  {t("setup.botToken")}{" "}
                  <span className="text-xs text-muted-foreground">
                    {t("setup.botTokenOptional")}
                  </span>
                </Label>
                <Input
                  id="botToken"
                  type="password"
                  placeholder={t("setup.botTokenPlaceholder")}
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("setup.botTokenHint")}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model">{t("setup.model")}</Label>
                {availableModels.length === 0 ? (
                  <p className="text-sm text-destructive">
                    {t("setup.noModels")}
                  </p>
                ) : (
                  <Select
                    value={model}
                    onValueChange={(v) => setModel(v ?? model)}
                  >
                    <SelectTrigger id="setup-model-select-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {m.provider}
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
              <Button onClick={handleCreateAgent} disabled={loading}>
                {loading ? t("common.creating") : t("setup.createAgentBtn")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
  onChange: (v: string) => void;
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
