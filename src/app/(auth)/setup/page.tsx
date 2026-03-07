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
import { getAvailableModels } from "@/lib/models";

const STEPS = [
  { title: "Connect Supabase", desc: "Link your project and initialize the database" },
  { title: "Create Admin Account", desc: "Register the first administrator" },
  { title: "Configure API Keys", desc: "Set up LLM and service credentials" },
  { title: "Create Your Agent", desc: "Set up your first AI agent" },
];

export default function SetupPage() {
  const router = useRouter();
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

## Scheduling
- Use \`schedule_reminder\` when the user asks for timed reminders or recurring tasks. Convert natural language time to cron expressions (UTC timezone).
- Use \`list_scheduled_jobs\` and \`cancel_scheduled_job\` to manage existing reminders.
- Always confirm the scheduled time with the user after creating a reminder.

## Tool Usage
- Call \`get_current_time\` when you need to know the current date/time for scheduling or time-sensitive questions.
- You may call multiple tools in sequence to fulfill complex requests.
- If a tool call fails, explain the error to the user and suggest alternatives.

## Personality
- Warm but efficient. Think of yourself as a capable personal secretary.
- Use humor sparingly and appropriately.
- Proactively offer help when you notice patterns (e.g. "You seem to ask about X often — want me to set a reminder?").`
  );
  const [model, setModel] = useState("");
  const [botToken, setBotToken] = useState("");
  const [availableModels, setAvailableModels] = useState<
    ReturnType<typeof getAvailableModels>
  >([]);

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

  // Step 0: Connect Supabase + initialize DB
  const handleConnect = async () => {
    if (!supabasePAT.trim()) {
      toast.error("Supabase Access Token is required");
      return;
    }
    if (!projectRef.trim()) {
      toast.error("Project Ref is required");
      return;
    }
    setLoading(true);
    try {
      toast.info("Initializing database schema...");
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
      toast.success(data.message || "Database initialized");
      setCurrentStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Register admin (passes PAT + ref for Management API bootstrap)
  const handleRegister = async () => {
    if (!email || !password) {
      toast.error("Please fill in both email and password");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
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
      toast.success("Admin account created");
      setCurrentStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Save API keys
  const handleSecrets = async () => {
    if (!secrets.SUPABASE_SERVICE_ROLE_KEY) {
      toast.error("Supabase Service Role Key is required");
      return;
    }
    const hasLLMKey =
      secrets.OPENAI_API_KEY ||
      secrets.ANTHROPIC_API_KEY ||
      secrets.GOOGLE_GENERATIVE_AI_API_KEY ||
      secrets.DEEPSEEK_API_KEY;
    if (!hasLLMKey) {
      toast.error("At least one LLM API Key is required");
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
      toast.success(`${data.count} keys saved`);
      const filledKeys = Object.entries(secrets)
        .filter(([, v]) => v.trim() !== "")
        .map(([k]) => k);
      loadAvailableModels(filledKeys);
      setCurrentStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save keys");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Create agent
  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      toast.error("Agent name is required");
      return;
    }
    // bot token is optional — can be configured later in dashboard
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
          access_token: supabasePAT,
          project_ref: projectRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agent created! Redirecting to dashboard...");
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create agent"
      );
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Checking setup status...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight">OpenCrab Setup</h1>
        <p className="text-muted-foreground">
          Step {currentStep + 1} of {STEPS.length} — {STEPS[currentStep].desc}
        </p>
      </div>

      <div className="flex gap-2">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-2 w-12 rounded-full transition-colors ${
              i <= currentStep ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{STEPS[currentStep].title}</CardTitle>
          <CardDescription>{STEPS[currentStep].desc}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Step 0: Connect Supabase */}
          {currentStep === 0 && (
            <div className="flex flex-col gap-4">
              <SecretField
                label="Supabase Access Token (PAT)"
                required
                hint="Supabase Dashboard → Account → Access Tokens → Generate new token"
                value={supabasePAT}
                onChange={setSupabasePAT}
              />
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">
                  Supabase Project Ref <span className="ml-1 text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. gjtcqawhjgaohawslmbs"
                  value={projectRef}
                  onChange={(e) => setProjectRef(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  From your project URL: https://&lt;ref&gt;.supabase.co
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                This will create all required tables, enable pg_cron and pg_net extensions,
                and store your Supabase credentials securely.
              </div>
              <Button onClick={handleConnect} disabled={loading}>
                {loading ? "Initializing database..." : "Connect & Initialize"}
              </Button>
            </div>
          )}

          {/* Step 1: Create Admin */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={handleRegister} disabled={loading}>
                {loading ? "Creating..." : "Create Admin Account"}
              </Button>
            </div>
          )}

          {/* Step 2: API Keys */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-4">
              <SecretField
                label="Supabase Service Role Key"
                required
                hint="Supabase Dashboard → Settings → API → service_role (secret)"
                value={secrets.SUPABASE_SERVICE_ROLE_KEY}
                onChange={(v) =>
                  setSecrets((s) => ({ ...s, SUPABASE_SERVICE_ROLE_KEY: v }))
                }
              />
              <div className="border-t pt-4">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  LLM API Keys (at least one required)
                </p>
                <div className="flex flex-col gap-3">
                  <SecretField
                    label="Anthropic API Key"
                    value={secrets.ANTHROPIC_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, ANTHROPIC_API_KEY: v }))
                    }
                  />
                  <SecretField
                    label="OpenAI API Key"
                    value={secrets.OPENAI_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, OPENAI_API_KEY: v }))
                    }
                  />
                  <SecretField
                    label="Google AI API Key"
                    value={secrets.GOOGLE_GENERATIVE_AI_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({
                        ...s,
                        GOOGLE_GENERATIVE_AI_API_KEY: v,
                      }))
                    }
                  />
                  <SecretField
                    label="DeepSeek API Key"
                    value={secrets.DEEPSEEK_API_KEY}
                    onChange={(v) =>
                      setSecrets((s) => ({ ...s, DEEPSEEK_API_KEY: v }))
                    }
                  />
                </div>
              </div>
              <SecretField
                label="Embedding API Key (Gemini recommended)"
                value={secrets.EMBEDDING_API_KEY}
                onChange={(v) =>
                  setSecrets((s) => ({ ...s, EMBEDDING_API_KEY: v }))
                }
              />
              <Button onClick={handleSecrets} disabled={loading}>
                {loading ? "Saving..." : "Save & Continue"}
              </Button>
            </div>
          )}

          {/* Step 3: Create Agent */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="agentName">Agent Name</Label>
                <Input
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="botToken">
                  Telegram Bot Token <span className="text-xs text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="botToken"
                  type="password"
                  placeholder="Paste token from @BotFather"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create a bot via @BotFather on Telegram, then paste the token here.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="model">Model</Label>
                {availableModels.length === 0 ? (
                  <p className="text-sm text-destructive">
                    No models available. Go back and add at least one LLM API Key.
                  </p>
                ) : (
                  <Select value={model} onValueChange={(v) => setModel(v ?? model)}>
                    <SelectTrigger>
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="systemPrompt">System Prompt</Label>
                <Textarea
                  id="systemPrompt"
                  rows={12}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
              <Button onClick={handleCreateAgent} disabled={loading}>
                {loading ? "Creating..." : "Create Agent & Finish"}
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
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  hint?: string;
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
        placeholder="Paste your key here..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
