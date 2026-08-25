import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderStatus = "idle" | "requesting" | "recording" | "encoding" | "ready" | "error";
export type VoiceRecorderErrorCode =
  | "microphoneUnavailable"
  | "microphoneDenied"
  | "recordingFailed"
  | "encodingFailed";

export type FlacVoiceRecording = {
  id: string;
  blob: Blob;
  durationMs: number;
};

type AudioContextConstructor = new () => AudioContext;

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const browserWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return (typeof AudioContext === "undefined" ? null : AudioContext) ?? browserWindow.webkitAudioContext ?? null;
}

function getErrorCode(error: unknown): VoiceRecorderErrorCode {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphoneDenied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") return "microphoneUnavailable";
  return "recordingFailed";
}

function mergeChunks(chunks: readonly Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodePcmInWorker(pcm: Float32Array, sampleRate: number, workerRef: MutableRefObject<Worker | null>) {
  return new Promise<FlacVoiceRecording>((resolve, reject) => {
    const worker = new Worker(new URL("../workers/deliveryFlacEncoder.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const finish = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    worker.addEventListener("message", (event: MessageEvent<{ type: string; flac?: ArrayBuffer; durationMs?: number; message?: string }>) => {
      finish();
      if (event.data.type === "success" && event.data.flac && event.data.durationMs) {
        resolve({
          id: crypto.randomUUID(),
          blob: new Blob([event.data.flac], { type: "audio/flac" }),
          durationMs: event.data.durationMs,
        });
        return;
      }
      reject(new Error(event.data.message || "FLAC encoding failed."));
    }, { once: true });
    worker.addEventListener("error", () => {
      finish();
      reject(new Error("FLAC encoding failed."));
    }, { once: true });
    worker.postMessage({ type: "encode", pcm: pcm.buffer, sampleRate }, [pcm.buffer]);
  });
}

export function useFlacVoiceRecorder() {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [recording, setRecording] = useState<FlacVoiceRecording | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceRecorderErrorCode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const statusRef = useRef<VoiceRecorderStatus>("idle");

  const updateStatus = useCallback((next: VoiceRecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseCapture = useCallback(async () => {
    clearTimer();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }, [clearTimer]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording") return null;
    updateStatus("encoding");
    const chunks = chunksRef.current;
    const sampleRate = sampleRateRef.current;
    await releaseCapture();
    chunksRef.current = [];

    try {
      const pcm = mergeChunks(chunks);
      const encoded = await encodePcmInWorker(pcm, sampleRate, workerRef);
      setRecording(encoded);
      setDurationMs(encoded.durationMs);
      setErrorCode(null);
      updateStatus("ready");
      return encoded;
    } catch {
      setErrorCode("encodingFailed");
      updateStatus("error");
      return null;
    }
  }, [releaseCapture, updateStatus]);

  const start = useCallback(async () => {
    if (statusRef.current === "requesting" || statusRef.current === "recording" || statusRef.current === "encoding") return false;
    if (!navigator.mediaDevices?.getUserMedia || !getAudioContextConstructor()) {
      setErrorCode("microphoneUnavailable");
      updateStatus("error");
      return false;
    }

    setErrorCode(null);
    setDurationMs(0);
    setRecording(null);
    chunksRef.current = [];
    updateStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const AudioContextClass = getAudioContextConstructor();
      if (!AudioContextClass) throw new DOMException("No AudioContext is available.", "NotSupportedError");
      const audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.setValueAtTime(0, audioContext.currentTime);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        if (input.numberOfChannels < 1) return;
        chunksRef.current.push(new Float32Array(input.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
      sampleRateRef.current = audioContext.sampleRate;
      startedAtRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.min(MAX_RECORDING_DURATION_MS, Date.now() - startedAtRef.current);
        setDurationMs(elapsed);
        if (elapsed >= MAX_RECORDING_DURATION_MS) void stop();
      }, 250);
      updateStatus("recording");
      return true;
    } catch (error) {
      await releaseCapture();
      setErrorCode(getErrorCode(error));
      updateStatus("error");
      return false;
    }
  }, [releaseCapture, stop, updateStatus]);

  const discard = useCallback(() => {
    if (statusRef.current === "recording" || statusRef.current === "encoding" || statusRef.current === "requesting") return;
    setRecording(null);
    setDurationMs(0);
    setErrorCode(null);
    updateStatus("idle");
  }, [updateStatus]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && statusRef.current === "recording") void stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      workerRef.current?.terminate();
      workerRef.current = null;
      void releaseCapture();
    };
  }, [releaseCapture, stop]);

  return { status, durationMs, recording, errorCode, start, stop, discard };
}
