import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { FLACDecoderWebWorker, type FLACDecodedAudio } from "@wasm-audio-decoders/flac";
import { useTranslation } from "react-i18next";

import { downloadVoiceStorageObject } from "@/services/voiceStorage";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

type FlacAudioSource =
  | { kind: "blob"; blob: Blob }
  | { kind: "storage"; path: string };

type DecodedVoice = Pick<FLACDecodedAudio, "channelData" | "samplesDecoded" | "sampleRate">;

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function createAudioContext() {
  const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextClass = (typeof AudioContext === "undefined" ? null : AudioContext) ?? browserWindow.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio playback is not supported in this browser.");
  return new AudioContextClass();
}

async function loadAudioData(source: FlacAudioSource, signal: AbortSignal) {
  if (source.kind === "blob") return source.blob.arrayBuffer();
  if (signal.aborted) throw new DOMException("Audio loading was cancelled.", "AbortError");
  return (await downloadVoiceStorageObject(source.path)).arrayBuffer();
}

export function FlacAudioPlayer({ source, className }: { source: FlacAudioSource; className?: string }) {
  const { t } = useTranslation();
  const [decoded, setDecoded] = useState<DecodedVoice | null>(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const decoderRef = useRef<FLACDecoderWebWorker | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const durationMs = decoded ? Math.round((decoded.samplesDecoded / decoded.sampleRate) * 1000) : 0;

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
  }, []);

  const stopPlayback = useCallback((preservePosition: boolean) => {
    const context = contextRef.current;
    const sourceNode = sourceNodeRef.current;
    if (context && sourceNode && preservePosition) {
      offsetRef.current += Math.max(0, context.currentTime - startedAtRef.current);
      setPositionMs(Math.round(offsetRef.current * 1000));
    }
    sourceNode?.stop();
    sourceNodeRef.current = null;
    clearProgressTimer();
    setIsPlaying(false);
  }, [clearProgressTimer]);

  const releasePlayback = useCallback(() => {
    stopPlayback(false);
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, [stopPlayback]);

  useEffect(() => {
    const abortController = new AbortController();
    let isCurrent = true;
    setDecoded(null);
    setError(false);
    setIsLoading(true);
    setPositionMs(0);
    offsetRef.current = 0;
    releasePlayback();

    void (async () => {
      try {
        const input = await loadAudioData(source, abortController.signal);
        if (abortController.signal.aborted) return;
        const bytes = new Uint8Array(input);
        if (bytes.length < 4 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
          throw new Error("The stored recording is not valid FLAC audio.");
        }
        const decoder = new FLACDecoderWebWorker();
        decoderRef.current = decoder;
        await decoder.ready;
        const output = await decoder.decodeFile(bytes);
        await decoder.free();
        if (decoderRef.current === decoder) decoderRef.current = null;
        if (!isCurrent || abortController.signal.aborted || output.samplesDecoded < 1) return;
        setDecoded(output);
      } catch (loadError) {
        if (!abortController.signal.aborted) {
          console.error("[Post Service] Failed to load voice reason:", loadError);
          setError(true);
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    })();

    return () => {
      isCurrent = false;
      abortController.abort();
      const decoder = decoderRef.current;
      decoderRef.current = null;
      if (decoder) void decoder.free().catch(() => undefined);
      releasePlayback();
    };
  }, [releasePlayback, source]);

  const play = useCallback(async () => {
    if (!decoded) return;
    try {
      const context = contextRef.current ?? createAudioContext();
      contextRef.current = context;
      await context.resume();
      const audioBuffer = context.createBuffer(decoded.channelData.length, decoded.samplesDecoded, decoded.sampleRate);
      decoded.channelData.forEach((channel, index) => audioBuffer.copyToChannel(channel, index));
      if (offsetRef.current >= audioBuffer.duration) offsetRef.current = 0;
      const sourceNode = context.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(context.destination);
      sourceNode.onended = () => {
        if (sourceNodeRef.current !== sourceNode) return;
        sourceNodeRef.current = null;
        offsetRef.current = 0;
        setPositionMs(0);
        clearProgressTimer();
        setIsPlaying(false);
      };
      sourceNodeRef.current = sourceNode;
      startedAtRef.current = context.currentTime;
      sourceNode.start(0, offsetRef.current);
      setIsPlaying(true);
      clearProgressTimer();
      progressTimerRef.current = setInterval(() => {
        const next = Math.min(audioBuffer.duration, offsetRef.current + (context.currentTime - startedAtRef.current));
        setPositionMs(Math.round(next * 1000));
      }, 200);
    } catch (playbackError) {
      console.error("[Post Service] Failed to play voice reason:", playbackError);
      setError(true);
    }
  }, [clearProgressTimer, decoded]);

  if (isLoading) {
    return <div className={cn("flex min-h-11 items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2", className)} role="status" aria-label={t("postService.voiceReason.loadingPlayback")}>
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full w-2/5 animate-pulse rounded-full bg-primary/35" /></div>
      <span className="sr-only">{t("postService.voiceReason.loadingPlayback")}</span>
    </div>;
  }
  if (error || !decoded) {
    return <div className={cn("flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive", className)} role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{t("postService.voiceReason.playbackFailed")}</div>;
  }

  return <div className={cn("flex min-h-11 items-center gap-3 rounded-lg border bg-muted/25 px-3 py-2", className)}>
    <Button type="button" size="icon" variant="outline" className="h-10 w-10 shrink-0" onClick={() => isPlaying ? stopPlayback(true) : void play()} aria-label={isPlaying ? t("postService.voiceReason.pause") : t("postService.voiceReason.play")}>
      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
    <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatDuration(positionMs)} / {formatDuration(durationMs)}</p>
    </div>
  </div>;
}
