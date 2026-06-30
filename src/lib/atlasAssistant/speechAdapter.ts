import { isDesktop } from "@/lib/platform";

import type {
  AssistantSpeechAdapter,
  AssistantSpeechAvailability,
  AssistantSpeechTranscript,
} from "./types";

const PLACEHOLDER_MESSAGE = "Voice-to-text is available only in the Tauri desktop app.";
const MAX_RECORDING_MS = 60000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const AUTO_STOP_SILENCE_MS = 1000;
const MIN_AUTO_STOP_RECORDING_MS = 1200;
const SPEECH_RMS_THRESHOLD = 0.018;
const SILENCE_RMS_THRESHOLD = 0.012;

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

interface KurdishTtsWebsiteStatusResponse {
  available: boolean;
  status: string;
  message: string;
  browser_path?: string | null;
  browserPath?: string | null;
}

interface KurdishTtsWebsiteTranscriptResponse {
  transcript: string;
  duration_ms?: number | null;
  durationMs?: number | null;
}

interface RecordedAudio {
  blob: Blob;
  durationMs: number;
  mimeType: string;
  sourceMimeType: string;
  sourceSize: number;
  level: AudioLevelSummary;
}

interface AudioLevelSummary {
  rms: number | null;
  peak: number | null;
  sampleCount: number;
}

interface AudioLevelFrame {
  rms: number;
  peak: number;
  sampleCount: number;
  timestampMs: number;
}

const PLACEHOLDER_AVAILABILITY: AssistantSpeechAvailability = {
  available: false,
  status: "placeholder_unavailable",
  message: PLACEHOLDER_MESSAGE,
};

function describeSpeechError(error: unknown, fallback = "Voice-to-text failed."): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // Fall through to the fallback message.
  }
  return fallback;
}

function hasRecorderSupport() {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined";
}

function chooseRecordingMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(describeSpeechError(error, `${command} failed.`));
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const [, payload = value] = value.split(",");
      resolve(payload);
    };
    reader.onerror = () => reject(reader.error || new Error("Recorded audio could not be read."));
    reader.readAsDataURL(blob);
  });
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const headerBytes = 44;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = headerBytes;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([view], { type: "audio/wav" });
}

async function convertRecordingToWav(blob: Blob) {
  const targetSampleRate = 16000;
  const AudioContextConstructor =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor || typeof OfflineAudioContext === "undefined") {
    return blob;
  }

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContextConstructor();
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const monoBuffer = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const monoData = monoBuffer.getChannelData(0);

    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
      const source = decoded.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < source.length; sampleIndex += 1) {
        monoData[sampleIndex] += source[sampleIndex] / decoded.numberOfChannels;
      }
    }

    const sourceNode = offline.createBufferSource();
    sourceNode.buffer = monoBuffer;
    sourceNode.connect(offline.destination);
    sourceNode.start();
    const rendered = await offline.startRendering();

    return encodePcm16Wav(rendered.getChannelData(0), targetSampleRate);
  } catch (error) {
    console.warn("[Atlas Voice] WAV conversion failed; uploading original recording", error);
    return blob;
  } finally {
    void audioContext?.close().catch(() => undefined);
  }
}

function createAudioLevelTracker(
  stream: MediaStream,
  options: { onFrame?: (frame: AudioLevelFrame) => void } = {},
) {
  const AudioContextConstructor =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return {
      stop: (): AudioLevelSummary => ({ rms: null, peak: null, sampleCount: 0 }),
    };
  }

  let animationFrame: number | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let sumSquares = 0;
  let peak = 0;
  let sampleCount = 0;

  try {
    audioContext = new AudioContextConstructor();
    source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(samples);
      let frameSumSquares = 0;
      let framePeak = 0;
      for (const sample of samples) {
        const absolute = Math.abs(sample);
        framePeak = Math.max(framePeak, absolute);
        peak = Math.max(peak, absolute);
        sumSquares += sample * sample;
        frameSumSquares += sample * sample;
      }
      sampleCount += samples.length;
      if (options.onFrame) {
        options.onFrame({
          rms: Math.sqrt(frameSumSquares / samples.length),
          peak: framePeak,
          sampleCount: samples.length,
          timestampMs: performance.now(),
        });
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
  } catch (error) {
    console.warn("[Atlas Voice] audio level tracker could not start", error);
  }

  return {
    stop: (): AudioLevelSummary => {
      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame);
      }
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        // Ignore cleanup errors from already closed audio nodes.
      }
      void audioContext?.close().catch(() => undefined);

      return {
        rms: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : null,
        peak: sampleCount > 0 ? peak : null,
        sampleCount,
      };
    },
  };
}

async function recordAudioUntilStopped(registerStop: (stop: () => void) => void): Promise<RecordedAudio> {
  if (!hasRecorderSupport()) {
    throw new Error("Microphone recording is not available in this environment.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = chooseRecordingMimeType();
  const chunks: Blob[] = [];
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder | null = null;
    let levelTracker: ReturnType<typeof createAudioLevelTracker> | null = null;
    let stopTimer: number | undefined;
    let settled = false;
    let speechDetected = false;
    let lastSpeechAt = startedAt;

    const finishWithError = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (stopTimer) window.clearTimeout(stopTimer);
      const level = levelTracker?.stop() ?? { rms: null, peak: null, sampleCount: 0 };
      stopStream(stream);
      console.error("[Atlas Voice] recording failed", {
        error,
        durationMs: Math.round(performance.now() - startedAt),
        level,
      });
      reject(error instanceof Error ? error : new Error("Voice recording failed."));
    };

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
      finishWithError(error);
      return;
    }

    const activeRecorder = recorder;

    const stopRecording = (reason: "manual" | "silence" | "limit") => {
      if (activeRecorder.state === "inactive") return;
      if (reason === "silence") {
        console.info("[Atlas Voice] recording stopped after silence", {
          silenceMs: AUTO_STOP_SILENCE_MS,
          speechRmsThreshold: SPEECH_RMS_THRESHOLD,
          silenceRmsThreshold: SILENCE_RMS_THRESHOLD,
        });
      }
      if (reason !== "manual") {
        window.dispatchEvent(new CustomEvent("atlas-assistant-voice-recording-stopped", {
          detail: { reason },
        }));
      }
      activeRecorder.stop();
    };

    levelTracker = createAudioLevelTracker(stream, {
      onFrame: ({ rms, timestampMs }) => {
        if (activeRecorder.state === "inactive") return;

        if (rms >= SPEECH_RMS_THRESHOLD) {
          speechDetected = true;
          lastSpeechAt = timestampMs;
          return;
        }

        if (
          speechDetected
          && rms <= SILENCE_RMS_THRESHOLD
          && timestampMs - startedAt >= MIN_AUTO_STOP_RECORDING_MS
          && timestampMs - lastSpeechAt >= AUTO_STOP_SILENCE_MS
        ) {
          stopRecording("silence");
        }
      },
    });

    activeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    activeRecorder.onerror = () => {
      finishWithError(new Error("Voice recording failed."));
    };

    activeRecorder.onstop = async () => {
      if (settled) return;
      settled = true;
      if (stopTimer) window.clearTimeout(stopTimer);
      const level = levelTracker?.stop() ?? { rms: null, peak: null, sampleCount: 0 };
      stopStream(stream);

      const blob = new Blob(chunks, {
        type: activeRecorder.mimeType || mimeType || "audio/webm",
      });

      const durationMs = Math.round(performance.now() - startedAt);

      console.info("[Atlas Voice] captured microphone audio", {
        durationMs,
        blobSize: blob.size,
        blobType: blob.type,
        chunkCount: chunks.length,
        rms: level.rms,
        peak: level.peak,
        sampleCount: level.sampleCount,
      });

      if (blob.size <= 0) {
        reject(new Error("No recorded audio was captured."));
        return;
      }

      if (blob.size > MAX_AUDIO_BYTES) {
        reject(new Error("Recorded audio is larger than the KurdishTTS 5 MB upload limit."));
        return;
      }

      const uploadBlob = await convertRecordingToWav(blob);

      if (uploadBlob.size > MAX_AUDIO_BYTES) {
        reject(new Error("Recorded audio is larger than the KurdishTTS 5 MB upload limit after WAV conversion."));
        return;
      }

      console.info("[Atlas Voice] prepared audio upload", {
        sourceBlobSize: blob.size,
        sourceBlobType: blob.type,
        uploadBlobSize: uploadBlob.size,
        uploadBlobType: uploadBlob.type,
      });

      resolve({
        blob: uploadBlob,
        durationMs,
        mimeType: uploadBlob.type || "audio/wav",
        sourceMimeType: blob.type || mimeType || "audio/webm",
        sourceSize: blob.size,
        level,
      });
    };

    try {
      activeRecorder.start();
      registerStop(() => {
        stopRecording("manual");
      });
      console.info("[Atlas Voice] recording started", {
        requestedMimeType: mimeType || "browser-default",
        recorderMimeType: activeRecorder.mimeType,
        durationLimitMs: MAX_RECORDING_MS,
        autoStopSilenceMs: AUTO_STOP_SILENCE_MS,
      });
      stopTimer = window.setTimeout(() => {
        if (activeRecorder.state !== "inactive") {
          console.info("[Atlas Voice] recording reached safety limit; stopping", {
            durationLimitMs: MAX_RECORDING_MS,
          });
          stopRecording("limit");
        }
      }, MAX_RECORDING_MS);
    } catch (error) {
      finishWithError(error);
    }
  });
}

export async function getSpeechAvailability(): Promise<AssistantSpeechAvailability> {
  if (!isDesktop()) {
    return PLACEHOLDER_AVAILABILITY;
  }

  if (!hasRecorderSupport()) {
    return {
      available: false,
      status: "microphone_unavailable",
      message: "Microphone recording is not available in this desktop webview.",
    };
  }

  try {
    const status = await invokeTauri<KurdishTtsWebsiteStatusResponse>(
      "atlas_assistant_kurdishtts_website_status",
    );

    return {
      available: status.available,
      status: status.available
        ? "kurdishtts_website_available"
        : "kurdishtts_website_unavailable",
      message: status.message,
    };
  } catch (error) {
    console.error("[Atlas Voice] availability check failed", error);
    return {
      available: false,
      status: "error",
      message: describeSpeechError(error, "KurdishTTS website transcription is not available."),
    };
  }
}

export function createPlaceholderSpeechAdapter(): AssistantSpeechAdapter {
  return {
    isAvailable: () => false,
    getAvailability: async () => PLACEHOLDER_AVAILABILITY,
    startDictation: async (): Promise<AssistantSpeechTranscript> => {
      throw new Error(PLACEHOLDER_MESSAGE);
    },
    stopDictation: () => false,
  };
}

export function createKurdishTtsWebsiteSpeechAdapter(): AssistantSpeechAdapter {
  let cachedAvailability: AssistantSpeechAvailability | null = null;
  let stopActiveRecording: (() => void) | null = null;

  return {
    isAvailable: () => isDesktop() && hasRecorderSupport(),
    getAvailability: async (forceRefresh = false) => {
      if (!forceRefresh && cachedAvailability) {
        return cachedAvailability;
      }

      cachedAvailability = await getSpeechAvailability();
      return cachedAvailability;
    },
    startDictation: async (): Promise<AssistantSpeechTranscript> => {
      if (stopActiveRecording) {
        throw new Error("Voice recording is already running.");
      }

      const availability = await getSpeechAvailability();
      cachedAvailability = availability;

      if (!availability.available) {
        throw new Error(availability.message);
      }

      try {
        const recorded = await recordAudioUntilStopped((stop) => {
          stopActiveRecording = stop;
        });
        stopActiveRecording = null;

        console.info("[Atlas Voice] sending recorded audio to KurdishTTS website", {
          durationMs: recorded.durationMs,
          blobSize: recorded.blob.size,
          mimeType: recorded.mimeType,
          sourceSize: recorded.sourceSize,
          sourceMimeType: recorded.sourceMimeType,
          rms: recorded.level.rms,
          peak: recorded.level.peak,
        });
        const audioBase64 = await blobToBase64(recorded.blob);
        const response = await invokeTauri<KurdishTtsWebsiteTranscriptResponse>(
          "atlas_assistant_transcribe_kurdishtts_website",
          {
            audioBase64,
            mimeType: recorded.mimeType,
            durationMs: recorded.durationMs,
          },
        );

        const transcript = response.transcript?.trim();
        if (!transcript) {
          throw new Error("KurdishTTS did not return a transcript.");
        }

        console.info("[Atlas Voice] KurdishTTS transcript received", {
          transcriptLength: transcript.length,
          durationMs: response.durationMs ?? response.duration_ms ?? recorded.durationMs,
        });

        return {
          transcript,
          language: "ku",
          confidence: null,
          durationMs: response.durationMs ?? response.duration_ms ?? recorded.durationMs,
        };
      } finally {
        stopActiveRecording = null;
      }
    },
    stopDictation: () => {
      if (!stopActiveRecording) {
        return false;
      }
      stopActiveRecording();
      return true;
    },
  };
}

export function createAtlasSpeechAdapter(): AssistantSpeechAdapter {
  return isDesktop()
    ? createKurdishTtsWebsiteSpeechAdapter()
    : createPlaceholderSpeechAdapter();
}

export const unavailableSpeechAdapter = createPlaceholderSpeechAdapter();
