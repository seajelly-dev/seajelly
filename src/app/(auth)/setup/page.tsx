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
import { MODEL_CATALOG, getAvailableModels } from "@/lib/models";

const STEPS = [
  { title: "Create Admin Account", desc: "Register the first administrator" },
  { title: "Configure API Keys", desc: "Set up required service credentials" },
  { title: "Create Your Agent", desc: "Set up your first AI agent" },
];

export default function SetupPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
    "You are a helpful AI assistant. Be concise, friendly, and proactive."
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
        const step = Math.min(data.currentStep ?? 0, 2);
        setCurrentStep(step);
        if (data.configuredKeys) {
          loadAvailableModels(data.configuredKeys);
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleRegister = async () => {
    if (!email || !password) {
      toast.error("Please fill in both email and password");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "register", email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Admin account created");
      setCurrentStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

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
        body: JSON.stringify({ step: "secrets", secrets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.count} keys saved`);
      const filledKeys = Object.entries(secrets)
        .filter(([, v]) => v.trim() !== "")
        .map(([k]) => k);
      loadAvailableModels(filledKeys);
      setCurrentStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save keys");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      toast.error("Agent name is required");
      return;
    }
    if (!botToken.trim()) {
      toast.error("Telegram Bot Token is required");
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
            className={`h-2 w-16 rounded-full transition-colors ${
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
          {currentStep === 0 && (
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
              <Button onClick={handleRegister} disabled={loading}>
                {loading ? "Creating..." : "Create Admin Account"}
              </Button>
            </div>
          )}

          {currentStep === 1 && (
            <div className="flex flex-col gap-4">
              <SecretField
                label="Supabase Service Role Key"
                required
                value={secrets.SUPABASE_SERVICE_ROLE_KEY}
                onChange={(v) =>
                  setSecrets((s) => ({
                    ...s,
                    SUPABASE_SERVICE_ROLE_KEY: v,
                  }))
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

          {currentStep === 2 && (
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
                  Telegram Bot Token <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="botToken"
                  type="password"
                  placeholder="Paste token from @BotFather"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create a bot via @BotFather on Telegram and paste the token here.
                  Each agent needs its own bot.
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
                  rows={6}
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
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
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
    </div>
  );
}
