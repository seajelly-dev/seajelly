"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";

export function useLiveAPI() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const genAIRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  const stop = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    genAIRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    workletNodeRef.current = null;

    sourcesRef.current.forEach((source) => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    inputAudioContextRef.current?.close().catch(console.error);
    inputAudioContextRef.current = null;

    outputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current = null;

    setIsConnected(false);
    setIsConnecting(false);
    setIsSpeaking(false);
  }, []);

  const schedulePcmPlayback = useCallback(async (pcm16: Int16Array) => {
    const outputAudioContext = outputAudioContextRef.current;
    if (!outputAudioContext) return;

    const buffer = outputAudioContext.createBuffer(1, pcm16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768.0;
    }

    const source = outputAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputAudioContext.destination);
    source.addEventListener("ended", () => {
      sourcesRef.current.delete(source);
      if (sourcesRef.current.size === 0) setIsSpeaking(false);
    });

    const nextStartTime = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
    source.start(nextStartTime);
    nextStartTimeRef.current = nextStartTime + buffer.duration;

    sourcesRef.current.add(source);
    setIsSpeaking(true);
  }, []);

  const connect = useCallback(async (apiKey: string, model: string, voiceName: string = "Aoede", systemInstruction?: string) => {
    if (isConnecting || isConnected) return;
    setIsConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      const inputAudioContext = new AudioContext({ sampleRate: 16000 });
      const outputAudioContext = new AudioContext({ sampleRate: 24000 });
      inputAudioContextRef.current = inputAudioContext;
      outputAudioContextRef.current = outputAudioContext;

      const genAI = new GoogleGenAI({ apiKey });
      genAIRef.current = genAI;

      const session = await genAI.live.connect({
        model,
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
          },
          onmessage: (message: LiveServerMessage) => {
            const parts = message.serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              const audio = part.inlineData;
              if (!audio?.data) continue;

              const binary = atob(audio.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              void schedulePcmPlayback(new Int16Array(bytes.buffer));
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              sourcesRef.current.forEach((source) => source.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: () => { stop(); },
          onclose: () => { stop(); },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          },
          systemInstruction: systemInstruction ? [{ text: systemInstruction }] : undefined
        }
      });
      sessionRef.current = session;

      await inputAudioContext.audioWorklet.addModule("/worklets/audio-processor.js");

      const source = inputAudioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(inputAudioContext, "audio-processor");

      workletNode.port.onmessage = (event) => {
        if (sessionRef.current) {
          const pcmBuffer = event.data as ArrayBuffer;
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer)));
          sessionRef.current.sendRealtimeInput({
            audio: { data: base64, mimeType: "audio/pcm;rate=16000" }
          });
        }
      };

      source.connect(workletNode);
      workletNode.connect(inputAudioContext.destination);
      workletNodeRef.current = workletNode;

    } catch (err) {
      console.error("Live API Connection Error:", err);
      setIsConnecting(false);
      stop();
    }
  }, [isConnecting, isConnected, schedulePcmPlayback, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { isConnected, isConnecting, isSpeaking, connect, stop };
}
