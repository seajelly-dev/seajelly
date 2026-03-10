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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GEMINI_VOICES,
  AISTUDIO_MODELS,
  CLOUD_GEMINI_MODELS,
  type TTSEngine,
} from "@/lib/voice/tts-config-data";

interface VoiceKeyInfo {
  id: string;
  engine: string;
  label: string;
  is_active: boolean;
}

export default function VoicePage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"tts" | "live" | "asr">("tts");

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<VoiceKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const [ttsKeyInput, setTtsKeyInput] = useState("");
  const [liveKeyInput, setLiveKeyInput] = useState("");
  const [asrKeyInput, setAsrKeyInput] = useState("");
  const [doubaoKeyInput, setDoubaoKeyInput] = useState("");
  const [doubaoProxyInput, setDoubaoProxyInput] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/voice");
      const data = await res.json();
      setSettings(data.settings || {});
      setKeys(data.keys || []);
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
      await fetch("/api/admin/voice", {
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

  const saveKey = async (engine: string, apiKey: string, extraConfig?: Record<string, string>) => {
    if (!apiKey.trim()) return;
    setSavingKey(engine);
    try {
      const res = await fetch("/api/admin/voice", {
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
      if (engine === "doubao-asr") { setDoubaoKeyInput(""); setDoubaoProxyInput(""); }
    } catch {
      toast.error(t("voice.keySaveFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const handlePreview = async () => {
    setPreviewPlaying(true);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t("voice.previewText"),
          engine: settings.tts_engine,
          model: settings.tts_model,
          voice: settings.tts_voice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS failed");

      const audioSrc = `data:${data.mimeType};base64,${data.audioBase64}`;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(audioSrc);
      audioRef.current = audio;
      audio.onended = () => setPreviewPlaying(false);
      audio.onerror = () => setPreviewPlaying(false);
      await audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
      setPreviewPlaying(false);
    }
  };

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewPlaying(false);
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
        {(["tts", "live", "asr"] as const).map((tab) => {
          const icons = { tts: Volume2, live: AudioLines, asr: Mic };
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
          {/* Status */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="size-5 text-muted-foreground" />
                  <CardTitle>TTS</CardTitle>
                </div>
                <Badge variant={settings.tts_enabled === "true" ? "secondary" : "destructive"} className="gap-1">
                  {settings.tts_enabled === "true" ? (
                    <><CheckCircle2 className="size-3.5" /> {t("voice.ttsEnabled")}</>
                  ) : (
                    <><XCircle className="size-3.5" /> {t("voice.ttsDisabled")}</>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="text-xs text-muted-foreground">{t("voice.ttsToggleHint")}</p>

              {/* Engine select */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t("voice.engine")}</Label>
                  <Select
                    value={settings.tts_engine || "aistudio"}
                    onValueChange={(v) => { if (v) updateSettings({ tts_engine: v }); }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {models.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.name} — {m.description}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Voice select */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("voice.voiceSelect")}</Label>
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {GEMINI_VOICES.map(v => (
                    <button
                      key={v.id}
                      onClick={() => updateSettings({ tts_voice: v.id })}
                      className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                        (settings.tts_voice || "Aoede") === v.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div>{v.name}</div>
                      <div className="text-[10px] opacity-60">
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

              {/* Preview */}
              {hasKey(ttsKeyEngine) && settings.tts_enabled === "true" && (
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={previewPlaying ? stopPreview : handlePreview}
                    disabled={previewPlaying && !audioRef.current}
                  >
                    {previewPlaying ? (
                      <><Square className="mr-1.5 size-4" /> {t("voice.previewPlaying")}</>
                    ) : (
                      <><Play className="mr-1.5 size-4" /> {t("voice.previewGenerate")}</>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("voice.voiceSelect")}: {settings.tts_voice || "Aoede"}
                  </span>
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
                  <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
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

              {/* Doubao ASR Key */}
              <div className="flex flex-col gap-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <Label>{t("voice.apiKey")} (doubao-asr)</Label>
                  {hasKey("doubao-asr") ? (
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3" /> {t("voice.apiKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3" /> {t("voice.apiKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Input
                    type="password"
                    placeholder={t("voice.apiKeyPlaceholder")}
                    value={doubaoKeyInput}
                    onChange={(e) => setDoubaoKeyInput(e.target.value)}
                    className="max-w-sm"
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">{t("voice.doubaoProxyUrl")}</Label>
                    <Input
                      placeholder={t("voice.doubaoProxyPlaceholder")}
                      value={doubaoProxyInput}
                      onChange={(e) => setDoubaoProxyInput(e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => saveKey("doubao-asr", doubaoKeyInput, { proxy_url: doubaoProxyInput })}
                    disabled={!doubaoKeyInput.trim() || savingKey === "doubao-asr"}
                  >
                    {savingKey === "doubao-asr" ? <Loader2 className="size-4 animate-spin" /> : t("voice.saveKey")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
