"use client";

import { useState, useEffect, useRef, use } from "react";
import { useASR } from "@/hooks/use-asr";
import { Mic, MicOff, Loader2, AlertTriangle, X, Trash2, Copy, Monitor, Check } from "lucide-react";

interface LinkConfig {
  type: string;
  config: Record<string, string>;
  expiresAt: string;
}

export default function AsrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [linkData, setLinkData] = useState<LinkConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const {
    isRecording,
    isConnecting,
    transcript,
    audioSource,
    setAudioSource,
    start,
    stop,
    clearTranscript,
  } = useASR();

  useEffect(() => {
    async function verify() {
      try {
        const res = await fetch(`/api/voice/temp-link?token=${token}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Invalid link");
          return;
        }
        setLinkData(data);
      } catch {
        setError("Failed to verify link");
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [token]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleStart = async () => {
    try {
      const res = await fetch(`/api/voice/asr-config?token=${token}`);
      const config = await res.json();
      if (!res.ok) {
        setError(config.error || "Failed to get config");
        return;
      }
      await start({
        engine: config.engine,
        apiKey: config.apiKey,
        model: config.model,
        proxyUrl: config.proxyUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start ASR");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (error && !linkData) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-6">
        <X className="size-12 text-red-500" />
        <h1 className="text-xl font-bold text-white">Link Invalid</h1>
        <p className="text-white/60 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Security warning */}
      <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-2.5">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300">
            Temporary link (expires {linkData?.expiresAt ? new Date(linkData.expiresAt).toLocaleString() : "soon"}).
            Do not share with anyone.
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${
            isRecording ? "bg-red-500 animate-pulse" : "bg-gray-500"
          }`} />
          <h1 className="text-white font-semibold text-lg">
            {isRecording ? "Recording..." : "ASR Transcription"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Audio source toggle */}
          <button
            onClick={() => setAudioSource(audioSource === "microphone" ? "system" : "microphone")}
            disabled={isRecording}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              audioSource === "system"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10"
            } ${isRecording ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {audioSource === "system" ? <Monitor className="size-3" /> : <Mic className="size-3" />}
            {audioSource === "system" ? "System" : "Mic"}
          </button>
        </div>
      </div>

      {/* Transcript area */}
      <div
        ref={transcriptRef}
        className="flex-1 px-6 py-6 overflow-y-auto"
      >
        {transcript ? (
          <p className="text-white/90 text-lg leading-relaxed whitespace-pre-wrap font-light">
            {transcript}
          </p>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <Mic className="size-16 text-white/10" />
            <p className="text-white/30 text-lg">
              {isRecording ? "Listening for speech..." : "Tap the button below to start transcription"}
            </p>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-6 py-2">
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 border-t border-white/5 flex items-center justify-center gap-4">
        {transcript && (
          <>
            <button
              onClick={handleCopy}
              className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            >
              {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            </button>
            <button
              onClick={clearTranscript}
              className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        )}

        {/* Main record button */}
        <button
          onClick={isRecording ? stop : handleStart}
          disabled={isConnecting}
          className={`h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 ${
            isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-[0_0_30px_rgba(239,68,68,0.4)]"
              : isConnecting
                ? "bg-white/10 cursor-wait"
                : "bg-linear-to-br from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
          }`}
        >
          {isConnecting ? (
            <Loader2 className="size-6 text-white animate-spin" />
          ) : isRecording ? (
            <MicOff className="size-6 text-white" />
          ) : (
            <Mic className="size-6 text-white" />
          )}
        </button>
      </div>
    </div>
  );
}
