"use client";

import { useState, useEffect, use } from "react";
import { useLiveAPI } from "@/hooks/use-live-api";
import { Mic, MicOff, Loader2, Wifi, AlertTriangle, X } from "lucide-react";

interface LinkConfig {
  type: string;
  config: Record<string, string>;
  agentId: string;
  expiresAt: string;
}

export default function LiveVoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [linkData, setLinkData] = useState<LinkConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState("Aoede");

  const { isConnected, isConnecting, isSpeaking, connect, stop } = useLiveAPI();

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
        if (data.config?.voice) setSelectedVoice(data.config.voice);
      } catch {
        setError("Failed to verify link");
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [token]);

  const handleStart = async () => {
    try {
      const res = await fetch(`/api/voice/live-config?token=${token}`);
      const config = await res.json();
      if (!res.ok) {
        setError(config.error || "Failed to get config");
        return;
      }
      connect(config.apiKey, config.model, selectedVoice);
    } catch {
      setError("Failed to connect");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-6">
        <X className="size-12 text-red-500" />
        <h1 className="text-xl font-bold text-white">Link Invalid</h1>
        <p className="text-white/60 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  const VOICES = ["Aoede", "Puck", "Kore", "Charon", "Zephyr"];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Security warning */}
      <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-2.5">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300">
            This is a temporary link (expires {linkData?.expiresAt ? new Date(linkData.expiresAt).toLocaleString() : "soon"}).
            Do not share this link with anyone.
          </p>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-6 py-4 flex items-center gap-3">
        <div className={`h-3 w-3 rounded-full shadow-[0_0_10px_currentColor] ${
          isConnected ? "bg-emerald-500 text-emerald-500" : "bg-gray-500 text-gray-500"
        } ${isConnecting ? "animate-pulse" : ""}`} />
        <span className="text-white/80 font-medium tracking-wide text-lg">
          {isConnecting ? "Connecting..." : isConnected ? "Gemini Live" : "Live Voice"}
        </span>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        {!isConnected && !isConnecting && (
          <div className="text-center space-y-8 animate-in slide-in-from-bottom-10 fade-in duration-700">
            <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
              Live Voice
            </h2>
            <p className="text-lg text-white/50 max-w-md mx-auto">
              Tap Connect to start a real-time voice conversation with AI
            </p>
          </div>
        )}

        {isConnected && (
          <div className="text-center">
            <div className={`w-32 h-32 rounded-full mx-auto flex items-center justify-center transition-all duration-500 ${
              isSpeaking
                ? "bg-linear-to-br from-violet-500 to-blue-500 scale-110 shadow-[0_0_60px_rgba(139,92,246,0.4)]"
                : "bg-white/10 scale-100"
            }`}>
              <Mic className={`size-12 text-white ${isSpeaking ? "animate-pulse" : ""}`} />
            </div>
            <p className="text-white/50 text-lg font-medium tracking-widest uppercase mt-6">
              {isSpeaking ? "AI Speaking..." : "Listening..."}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-6">
        {!isConnected && !isConnecting && (
          <>
            <div className="flex bg-white/5 backdrop-blur-md rounded-full p-1 border border-white/10">
              {VOICES.map((voice) => (
                <button
                  key={voice}
                  onClick={() => setSelectedVoice(voice)}
                  className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                    selectedVoice === voice
                      ? "bg-white text-black shadow-lg"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {voice}
                </button>
              ))}
            </div>
            <button
              onClick={handleStart}
              className="h-14 px-10 rounded-full bg-linear-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-[0_0_40px_rgba(79,70,229,0.4)] hover:shadow-[0_0_60px_rgba(79,70,229,0.6)] border-0 transition-all duration-300 hover:scale-105 font-bold text-lg flex items-center gap-2"
            >
              <Wifi className="size-5" />
              Connect
            </button>
          </>
        )}

        {isConnecting && (
          <div className="flex items-center gap-3 px-8 py-4 bg-white/10 backdrop-blur-md rounded-full border border-white/10 text-white">
            <Loader2 className="size-5 animate-spin" />
            <span>Initializing...</span>
          </div>
        )}

        {isConnected && (
          <button
            onClick={stop}
            className="h-14 w-14 rounded-full border-2 border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all duration-300 flex items-center justify-center"
          >
            <MicOff className="size-6" />
          </button>
        )}
      </div>
    </div>
  );
}
