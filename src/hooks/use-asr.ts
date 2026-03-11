"use client";

import { useState, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import pako from "pako";

type AsrEngine = "gemini-asr" | "doubao-asr";
type AudioSource = "microphone" | "system";

interface AsrConfig {
  engine: AsrEngine;
  apiKey?: string;
  model?: string;
  proxyUrl?: string;
}

// Doubao protocol constants
const DOUBAO_MSG_TYPE = {
  CLIENT_FULL: 0b0001,
  CLIENT_AUDIO: 0b0010,
  SERVER_FULL: 0b1001,
  SERVER_ERROR: 0b1111,
};

function buildDoubaoHeader(msgType: number, flags: number, ser = 1, comp = 1) {
  const h = new Uint8Array(4);
  h[0] = (1 << 4) | 1;
  h[1] = (msgType << 4) | flags;
  h[2] = (ser << 4) | comp;
  h[3] = 0;
  return h;
}

function buildDoubaoFullRequest(seq: number) {
  const header = buildDoubaoHeader(DOUBAO_MSG_TYPE.CLIENT_FULL, 0b0001);
  const payload = pako.gzip(new TextEncoder().encode(JSON.stringify({
    user: { uid: "seajelly_user" },
    audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
    request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, enable_ddc: true, show_utterances: true, enable_nonstream: false },
  })));
  const buf = new ArrayBuffer(12 + payload.length);
  const view = new DataView(buf);
  new Uint8Array(buf).set(header, 0);
  view.setInt32(4, seq, false);
  view.setUint32(8, payload.length, false);
  new Uint8Array(buf).set(payload, 12);
  return buf;
}

function buildDoubaoAudioRequest(seq: number, audioData: ArrayBuffer, isLast = false) {
  const flags = isLast ? 0b0011 : 0b0001;
  const header = buildDoubaoHeader(DOUBAO_MSG_TYPE.CLIENT_AUDIO, flags, 0, 1);
  const compressed = pako.gzip(new Uint8Array(audioData));
  const effectiveSeq = isLast ? -seq : seq;
  const buf = new ArrayBuffer(12 + compressed.length);
  const view = new DataView(buf);
  new Uint8Array(buf).set(header, 0);
  view.setInt32(4, effectiveSeq, false);
  view.setUint32(8, compressed.length, false);
  new Uint8Array(buf).set(compressed, 12);
  return buf;
}

function parseDoubaoResponse(data: ArrayBuffer) {
  const view = new DataView(data);
  const uint8 = new Uint8Array(data);
  const headerSize = uint8[0] & 0x0f;
  const msgType = uint8[1] >> 4;
  const flags = uint8[1] & 0x0f;
  const compression = uint8[2] & 0x0f;

  let offset = headerSize * 4;
  let isLast = false;

  if (flags & 0x01) { offset += 4; }
  if (flags & 0x02) { isLast = true; }
  if (flags & 0x04) { offset += 4; }

  if (msgType === DOUBAO_MSG_TYPE.SERVER_FULL) {
    offset += 4;
  } else if (msgType === DOUBAO_MSG_TYPE.SERVER_ERROR) {
    const code = view.getInt32(offset, false);
    console.error("[DoubaoASR] Error code:", code);
    offset += 8;
  }

  const payload = uint8.slice(offset);
  if (!payload.length) return { isLast, text: "" };

  let decoded: Uint8Array;
  try {
    decoded = compression === 1 ? pako.ungzip(payload) : payload;
  } catch {
    return { isLast, text: "" };
  }

  try {
    const json = JSON.parse(new TextDecoder().decode(decoded));
    const result = json?.result;
    if (result?.utterances?.length) {
      return { isLast, text: result.utterances.map((u: { text: string }) => u.text).join("") };
    }
    return { isLast, text: result?.text || "" };
  } catch {
    return { isLast, text: "" };
  }
}

export function useASR() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioSource, setAudioSource] = useState<AudioSource>("microphone");

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const lastTextRef = useRef("");
  const engineRef = useRef<AsrEngine>("gemini-asr");

  const cleanup = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const lastReq = buildDoubaoAudioRequest(seqRef.current, new ArrayBuffer(0), true);
      wsRef.current.send(lastReq);
      wsRef.current.close();
    }
    wsRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close().catch(console.error);
    audioContextRef.current = null;

    seqRef.current = 1;
    lastTextRef.current = "";
    setIsRecording(false);
    setIsConnecting(false);
  }, []);

  const startGemini = useCallback(async (config: AsrConfig) => {
    const genAI = new GoogleGenAI({ apiKey: config.apiKey! });

    const session = await genAI.live.connect({
      model: config.model || "gemini-2.5-flash-native-audio-preview-09-2025",
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription?.text) {
            setTranscript(prev => prev + message.serverContent!.inputTranscription!.text);
          }
        },
        onerror: () => { cleanup(); },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        systemInstruction: `You are a professional transcription assistant. Transcribe audio content verbatim in simplified Chinese.`,
      },
    });
    sessionRef.current = session;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    const constraints: MediaStreamConstraints = audioSource === "system"
      ? { audio: { echoCancellation: false, noiseSuppression: false } }
      : { audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    await audioContext.audioWorklet.addModule("/worklets/audio-processor.js");
    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "audio-processor");

    worklet.port.onmessage = (event) => {
      if (sessionRef.current) {
        const pcm = event.data as ArrayBuffer;
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm)));
        sessionRef.current.sendRealtimeInput({
          audio: { data: base64, mimeType: "audio/pcm;rate=16000" }
        });
      }
    };

    source.connect(worklet);
    worklet.connect(audioContext.destination);
  }, [audioSource, cleanup]);

  const startDoubao = useCallback(async (config: AsrConfig) => {
    const proxyUrl = config.proxyUrl;
    if (!proxyUrl) throw new Error("Doubao proxy URL not configured");

    const ws = new WebSocket(proxyUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Doubao connection timeout")), 10000);
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.send(buildDoubaoFullRequest(seqRef.current++));
        resolve();
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("Doubao connection failed")); };
    });

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const resp = parseDoubaoResponse(event.data);
      if (resp.text) {
        const prev = lastTextRef.current;
        let common = 0;
        const max = Math.min(prev.length, resp.text.length);
        while (common < max && prev.charCodeAt(common) === resp.text.charCodeAt(common)) common++;
        const delta = resp.text.slice(common);
        lastTextRef.current = resp.text;
        if (delta) setTranscript(prev => prev + delta);
      }
    };

    ws.onclose = () => { cleanup(); };

    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    const constraints: MediaStreamConstraints = audioSource === "system"
      ? { audio: { echoCancellation: false, noiseSuppression: false } }
      : { audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    await audioContext.audioWorklet.addModule("/worklets/pcm-worklet.js");
    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "pcm-worklet");

    worklet.port.onmessage = (event) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const req = buildDoubaoAudioRequest(seqRef.current++, event.data as ArrayBuffer);
        wsRef.current.send(req);
      }
    };

    source.connect(worklet);
    worklet.connect(audioContext.destination);
  }, [audioSource, cleanup]);

  const start = useCallback(async (config: AsrConfig) => {
    if (isRecording || isConnecting) return;
    setIsConnecting(true);
    engineRef.current = config.engine;

    try {
      if (config.engine === "gemini-asr") {
        await startGemini(config);
      } else {
        await startDoubao(config);
      }
      setIsRecording(true);
    } catch (err) {
      console.error("ASR start error:", err);
      cleanup();
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [isRecording, isConnecting, startGemini, startDoubao, cleanup]);

  const stop = useCallback(() => { cleanup(); }, [cleanup]);

  const clearTranscript = useCallback(() => { setTranscript(""); }, []);

  return {
    isRecording,
    isConnecting,
    transcript,
    audioSource,
    setAudioSource,
    start,
    stop,
    clearTranscript,
  };
}
