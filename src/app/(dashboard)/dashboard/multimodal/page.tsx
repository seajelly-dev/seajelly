"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Volume2,
  Mic,
  AudioLines,
  Loader2,
  CheckCircle2,
  XCircle,
  KeyRound,
  Play,
  Square,
  AlertTriangle,
  Info,
  ImageIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  GEMINI_VOICES,
  AISTUDIO_MODELS,
  CLOUD_GEMINI_MODELS,
  type TTSEngine,
} from "@/lib/voice/tts-config-data";
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_GEN_MODELS,
  getModelsForProvider,
  type ImageGenProvider,
} from "@/lib/image-gen/config-data";
import { cn } from "@/lib/utils";

interface VoiceKeyInfo {
  id: string;
  engine: string;
  label: string;
  is_active: boolean;
}

function clampMediaThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0.75;
  return Math.max(0, Math.min(1, value));
}

export default function VoicePage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"tts" | "live" | "asr" | "image_gen">("tts");

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<VoiceKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [ttsKeyInput, setTtsKeyInput] = useState("");
  const [liveKeyInput, setLiveKeyInput] = useState("");
  const [asrKeyInput, setAsrKeyInput] = useState("");
  const [doubaoProxyInput, setDoubaoProxyInput] = useState("");
  const [doubaoAppKeyInput, setDoubaoAppKeyInput] = useState("");
  const [doubaoAccessKeyInput, setDoubaoAccessKeyInput] = useState("");
  const [imageGenKeyInput, setImageGenKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [mediaThresholdDraft, setMediaThresholdDraft] = useState("0.75");
  const [savingMediaThreshold, setSavingMediaThreshold] = useState(false);

  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const [res, settingsRes] = await Promise.all([
        fetch("/api/admin/multimodal"),
        fetch("/api/admin/settings").catch(() => null),
      ]);
      const data = await res.json();
      setSettings(data.settings || {});
      setKeys(data.keys || []);

      let threshold = 0.75;
      if (settingsRes) {
        const sysData = await settingsRes.json().catch(() => ({}));
        const raw = (sysData.settings as Record<string, string> | undefined)?.knowledge_media_match_threshold;
        if (raw !== undefined) {
          threshold = clampMediaThreshold(Number(raw));
        }
      }
      setMediaThresholdDraft(threshold.toFixed(2));
    } catch {
      toast.error(t("voice.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const hasKey = (engine: string) => keys.some(k => k.engine === engine && k.is_active);

  const updateSettings = async (updates: Record<string, string>) => {
    try {
      await fetch("/api/admin/multimodal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", settings: updates }),
      });
      setSettings(prev => ({ ...prev, ...updates }));
      toast.success(t("voice.configSaved"));
    } catch {
      toast.error(t("voice.configSaveFailed"));
    }
  };

  const saveMediaThreshold = async () => {
    const raw = Number(mediaThresholdDraft);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
      toast.error(t("voice.mediaSearchThresholdInvalid"));
      return;
    }
    const parsed = Number(raw.toFixed(2));
    setSavingMediaThreshold(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "knowledge_media_match_threshold",
          value: parsed.toFixed(2),
        }),
      });
      if (!res.ok) {
        throw new Error("save failed");
      }
      setMediaThresholdDraft(parsed.toFixed(2));
      toast.success(t("voice.mediaSearchThresholdSaved"));
    } catch {
      toast.error(t("voice.mediaSearchThresholdSaveFailed"));
    } finally {
      setSavingMediaThreshold(false);
    }
  };

  const saveKey = async (engine: string, apiKey: string, extraConfig?: Record<string, string>) => {
    if (!apiKey.trim()) return;
    setSavingKey(engine);
    try {
      const res = await fetch("/api/admin/multimodal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", engine, apiKey: apiKey.trim(), extraConfig }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(t("voice.keySaved"));
      await loadConfig();
      if (engine === "aistudio" || engine === "cloud-gemini") setTtsKeyInput("");
      if (engine === "gemini-live") setLiveKeyInput("");
      if (engine === "gemini-asr") setAsrKeyInput("");
      if (engine === "google-image-gen") setImageGenKeyInput("");
    } catch {
      toast.error(t("voice.keySaveFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const handlePreview = async () => {
    if (previewPlaying || previewLoading) return;
    const text = previewText.trim() || t("voice.previewText");
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          engine: settings.tts_engine,
          model: settings.tts_model,
          voice: settings.tts_voice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS failed");

      const audioSrc = `data:${data.mimeType};base64,${data.audioBase64}`;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(audioSrc);
      audioRef.current = audio;
      audio.onended = () => { setPreviewPlaying(false); setPreviewLoading(false); };
      audio.onerror = () => { setPreviewPlaying(false); setPreviewLoading(false); };
      setPreviewPlaying(true);
      setPreviewLoading(false);
      await audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
      setPreviewPlaying(false);
      setPreviewLoading(false);
    }
  };

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewPlaying(false);
    setPreviewLoading(false);
  };

  const currentEngine = (settings.tts_engine || "aistudio") as TTSEngine;
  const models = currentEngine === "cloud-gemini" ? CLOUD_GEMINI_MODELS : AISTUDIO_MODELS;
  const ttsKeyEngine = currentEngine === "cloud-gemini" ? "cloud-gemini" : "aistudio";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("voice.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("voice.subtitle")}</p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["tts", "live", "asr", "image_gen"] as const).map((tab) => {
          const icons = { tts: Volume2, live: AudioLines, asr: Mic, image_gen: ImageIcon };
          const Icon = icons[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="inline-block mr-1.5 size-4" />
              {t(`voice.tabs.${tab}` as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      {/* TTS Tab */}
      {activeTab === "tts" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Volume2 className="size-5 text-muted-foreground" />
                <CardTitle>TTS</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3">
                <Info className="size-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800 dark:text-blue-300">{t("voice.ttsToggleHint")}</p>
              </div>

              {/* Engine select */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("voice.engine")}</Label>
                  <Select
                    value={settings.tts_engine || "aistudio"}
                    onValueChange={(v) => { if (v) updateSettings({ tts_engine: v }); }}
                  >
                    <SelectTrigger>
                      {settings.tts_engine === "cloud-gemini" ? "Cloud Gemini" : "AI Studio"}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aistudio">AI Studio</SelectItem>
                      <SelectItem value="cloud-gemini">Cloud Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("voice.model")}</Label>
                  <Select
                    value={settings.tts_model || models[0]?.id}
                    onValueChange={(v) => { if (v) updateSettings({ tts_model: v }); }}
                  >
                    <SelectTrigger>
                      <span className="truncate">
                        {models.find(m => m.id === (settings.tts_model || models[0]?.id))?.name || "Select"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {models.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">{m.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Voice select grid */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("voice.voiceSelect")}</Label>
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {GEMINI_VOICES.map(v => (
                    <button
                      key={v.id}
                      onClick={() => updateSettings({ tts_voice: v.id })}
                      className={cn(
                        "px-3 py-2 rounded-lg border text-sm transition-all",
                        (settings.tts_voice || "Aoede") === v.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div>{v.name}</div>
                      <div className={cn(
                        "text-[10px]",
                        v.gender === "male"
                          ? "text-blue-500"
                          : v.gender === "female"
                            ? "text-pink-500"
                            : "text-gray-500"
                      )}>
                        {v.gender === "male" ? t("voice.male") : v.gender === "female" ? t("voice.female") : t("voice.neutral")}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.apiKey")} ({ttsKeyEngine})</Label>
                  {hasKey(ttsKeyEngine) ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="password"
                    placeholder={t("voice.apiKeyPlaceholder")}
                    value={ttsKeyInput}
                    onChange={(e) => setTtsKeyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveKey(ttsKeyEngine, ttsKeyInput)}
                    disabled={!ttsKeyInput.trim() || savingKey === ttsKeyEngine}
                  >
                    {savingKey === ttsKeyEngine ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
              </div>

              {/* Preview section */}
              {hasKey(ttsKeyEngine) && (
                <div className="flex flex-col gap-3 pt-2 border-t">
                  <Label>{t("voice.previewTitle")}</Label>
                  <Textarea
                    placeholder={t("voice.previewPlaceholder")}
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      onClick={previewPlaying ? stopPreview : handlePreview}
                      disabled={previewLoading}
                      className="gap-1.5"
                    >
                      {previewLoading ? (
                        <><Loader2 className="size-4 animate-spin" /> {t("voice.previewLoading")}</>
                      ) : previewPlaying ? (
                        <><Square className="size-4" /> {t("voice.previewPlaying")}</>
                      ) : (
                        <><Play className="size-4" /> {t("voice.previewGenerate")}</>
                      )}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {settings.tts_voice || "Aoede"} · {models.find(m => m.id === (settings.tts_model || models[0]?.id))?.name || ""}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Live Voice Tab */}
      {activeTab === "live" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AudioLines className="size-5 text-muted-foreground" />
                <CardTitle>{t("voice.tabs.live")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">{t("voice.liveDescription")}</p>

              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">{t("voice.securityWarning")}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t("voice.liveVoice")}</Label>
                <Select
                  value={settings.live_voice || "Aoede"}
                  onValueChange={(v) => { if (v) updateSettings({ live_voice: v }); }}
                >
                  <SelectTrigger className="max-w-xs">
                    {GEMINI_VOICES.find(v => v.id === (settings.live_voice || "Aoede"))?.name || "Aoede"}
                  </SelectTrigger>
                  <SelectContent>
                    {GEMINI_VOICES.slice(0, 10).map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.apiKey")} (gemini-live)</Label>
                  {hasKey("gemini-live") ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="password"
                    placeholder={t("voice.apiKeyPlaceholder")}
                    value={liveKeyInput}
                    onChange={(e) => setLiveKeyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveKey("gemini-live", liveKeyInput)}
                    disabled={!liveKeyInput.trim() || savingKey === "gemini-live"}
                  >
                    {savingKey === "gemini-live" ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ASR Tab */}
      {activeTab === "asr" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mic className="size-5 text-muted-foreground" />
                <CardTitle>{t("voice.tabs.asr")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">{t("voice.asrDescription")}</p>

              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">{t("voice.securityWarning")}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t("voice.asrEngine")}</Label>
                <Select
                  value={settings.asr_engine || "gemini-asr"}
                  onValueChange={(v) => { if (v) updateSettings({ asr_engine: v }); }}
                >
                  <SelectTrigger className="max-w-xs">
                    {settings.asr_engine === "doubao-asr" ? t("voice.doubaoAsr") : t("voice.geminiAsr")}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini-asr">{t("voice.geminiAsr")}</SelectItem>
                    <SelectItem value="doubao-asr">{t("voice.doubaoAsr")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Gemini ASR Key */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.apiKey")} (gemini-asr)</Label>
                  {hasKey("gemini-asr") ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="password"
                    placeholder={t("voice.apiKeyPlaceholder")}
                    value={asrKeyInput}
                    onChange={(e) => setAsrKeyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveKey("gemini-asr", asrKeyInput)}
                    disabled={!asrKeyInput.trim() || savingKey === "gemini-asr"}
                  >
                    {savingKey === "gemini-asr" ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
              </div>

              {/* Doubao ASR */}
              <div className="flex flex-col gap-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.doubaoAsr")}</Label>
                  {(settings.doubao_app_key && settings.doubao_access_key) || settings.doubao_proxy_url ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("voice.doubaoCredentialsHint")}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">App Key</Label>
                    <Input
                      type="password"
                      placeholder="doubao_app_key"
                      value={doubaoAppKeyInput}
                      onChange={(e) => setDoubaoAppKeyInput(e.target.value)}
                      className="w-56"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Access Key</Label>
                    <Input
                      type="password"
                      placeholder="doubao_access_key"
                      value={doubaoAccessKeyInput}
                      onChange={(e) => setDoubaoAccessKeyInput(e.target.value)}
                      className="w-56"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateSettings({
                      doubao_app_key: doubaoAppKeyInput.trim(),
                      doubao_access_key: doubaoAccessKeyInput.trim(),
                    })}
                    disabled={!doubaoAppKeyInput.trim() || !doubaoAccessKeyInput.trim()}
                  >
                    {t("voice.saveKey")}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground mt-2">{t("voice.doubaoProxyHint")}</p>
                <div className="flex items-end gap-2">
                  <Input
                    placeholder={t("voice.doubaoProxyPlaceholder")}
                    value={doubaoProxyInput}
                    onChange={(e) => setDoubaoProxyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateSettings({ doubao_proxy_url: doubaoProxyInput.trim() })}
                    disabled={!doubaoProxyInput.trim()}
                  >
                    {t("voice.saveKey")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Image Generation Tab */}
      {activeTab === "image_gen" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ImageIcon className="size-5 text-muted-foreground" />
                <CardTitle>{t("voice.imageGenTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">{t("voice.imageGenDescription")}</p>

              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3">
                <Info className="size-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800 dark:text-blue-300">{t("voice.imageGenToggleHint")}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("voice.imageGenProvider")}</Label>
                  <Select
                    value={settings.image_gen_provider || "google"}
                    onValueChange={(v) => {
                      if (!v) return;
                      const providerModels = getModelsForProvider(v as ImageGenProvider);
                      updateSettings({
                        image_gen_provider: v,
                        image_gen_model: providerModels[0]?.id || "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      {IMAGE_GEN_PROVIDERS[(settings.image_gen_provider || "google") as ImageGenProvider]?.name || "Google"}
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(IMAGE_GEN_PROVIDERS) as ImageGenProvider[]).map((p) => (
                        <SelectItem key={p} value={p}>{IMAGE_GEN_PROVIDERS[p].name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t("voice.imageGenModel")}</Label>
                  <Select
                    value={settings.image_gen_model || IMAGE_GEN_MODELS[0]?.id}
                    onValueChange={(v) => { if (v) updateSettings({ image_gen_model: v }); }}
                  >
                    <SelectTrigger>
                      <span className="truncate">
                        {IMAGE_GEN_MODELS.find(m => m.id === (settings.image_gen_model || IMAGE_GEN_MODELS[0]?.id))?.name || "Select"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {getModelsForProvider((settings.image_gen_provider || "google") as ImageGenProvider).map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">{m.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.apiKey")} (google-image-gen)</Label>
                  {hasKey("google-image-gen") ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="password"
                    placeholder={t("voice.apiKeyPlaceholder")}
                    value={imageGenKeyInput}
                    onChange={(e) => setImageGenKeyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveKey("google-image-gen", imageGenKeyInput)}
                    disabled={!imageGenKeyInput.trim() || savingKey === "google-image-gen"}
                  >
                    {savingKey === "google-image-gen" ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ImageIcon className="size-5 text-muted-foreground" />
                <CardTitle>{t("voice.mediaSearchTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">{t("voice.mediaSearchDescription")}</p>

              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4">
                <div className="flex items-start gap-2">
                  <Info className="size-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">{t("voice.mediaSearchHint")}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>{t("voice.mediaSearchThreshold")}</Label>
                  <Badge variant="secondary">{Math.round(clampMediaThreshold(Number(mediaThresholdDraft)) * 100)}%</Badge>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.01}
                  value={clampMediaThreshold(Number(mediaThresholdDraft))}
                  onChange={(e) => setMediaThresholdDraft(Number(e.target.value).toFixed(2))}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
                <div className="flex items-end gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mediaThresholdDraft}
                    onChange={(e) => setMediaThresholdDraft(e.target.value)}
                    className="max-w-28"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={saveMediaThreshold}
                    disabled={savingMediaThreshold}
                  >
                    {savingMediaThreshold ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("voice.mediaSearchThresholdHint")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("voice.mediaSearchThresholdRule", {
                    threshold: Math.round(clampMediaThreshold(Number(mediaThresholdDraft)) * 100).toString(),
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
