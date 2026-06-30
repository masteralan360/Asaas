import { isTauri } from "@/lib/platform";
import type {
  AssistantSpeechAdapter,
  AssistantSpeechAvailability,
  AssistantSpeechTranscript,
} from "./types";

const UNAVAILABLE_MESSAGE = "Sorani voice-to-text is not installed yet. Type your question for now.";
const DEFAULT_RECORDING_MS = 7_000;
const TARGET_SAMPLE_RATE = 16_000;

interface SoraniAsrStatusResponse {
  available: boolean;
  status: AssistantSpeechAvailability["status"];
  message: string;
  enginePath?: string | null;
  modelPath?: string | null;
  expectedInterface?: string | null;
}

interface SoraniAsrTranscriptionResponse {
  transcript: string;
  language?: "ckb" | "ku" | "sorani";
  confidence?: number | null;
  durationMs?: number | null;
  engine?: string | null;
}

interface RecordedAudio {
  audioBase64: string;
  mimeType: "audio/wav";
  durationMs: number;
}

interface SoraniSpeechAdapterOptions {
  recordingMs?: number;
}

let cachedAvailability: AssistantSpeechAvailability | null = null;

function unavailable(
  status: AssistantSpeechAvailability["status"],
  message = UNAVAILABLE_MESSAGE,
): AssistantSpeechAvailability {
  return {
    available: false,
    status,
    message,
    enginePath: null,
    modelPath: null,
    expectedInterface: null,
  };
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

function hasMicrophoneRecordingSupport() {
  return !!(
    typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && getAudioContextConstructor()
  );
}

async function queryTauriAsrStatus(): Promise<AssistantSpeechAvailability> {
  if (!isTauri()) {
    return unavailable(
      "not_tauri",
      "Sorani voice-to-text is only available in the Atlas desktop app because it runs a local ASR engine.",
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return unavailable(
      "missing_microphone",
      "This device/browser does not expose microphone recording to Atlas.",
    );
  }

  if (!getAudioContextConstructor()) {
    return unavailable(
      "missing_audio_context",
      "This device/browser cannot prepare microphone audio for the local Sorani ASR engine.",
    );
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<SoraniAsrStatusResponse>("atlas_assistant_sorani_asr_status");
    return {
      available: Boolean(status.available),
      status: status.status,
      message: status.message || UNAVAILABLE_MESSAGE,
      enginePath: status.enginePath ?? null,
      modelPath: status.modelPath ?? null,
      expectedInterface: status.expectedInterface ?? null,
    };
  } catch (error) {
    return unavailable(
      "command_unavailable",
      error instanceof Error
        ? `Sorani voice-to-text bridge is not available: ${error.message}`
        : "Sorani voice-to-text bridge is not available in this Atlas build.",
    );
  }
}

export async function getSoraniSpeechAvailability(forceRefresh = false): Promise<AssistantSpeechAvailability> {
  if (cachedAvailability && !forceRefresh) {
    return cachedAvailability;
  }

  cachedAvailability = await queryTauriAsrStatus();
  return cachedAvailability;
}

function mergeChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input;

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = sourceIndex - leftIndex;
    output[index] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
  }

  return output;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
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
  view.setUint32(40, dataSize, true);

  let offset = 44;
  samples.forEach((sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  });

  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function recordSoraniQuestion(recordingMs: number): Promise<RecordedAudio> {
  if (!hasMicrophoneRecordingSupport()) {
    throw new Error("Microphone recording is not available on this device.");
  }

  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is not available on this device.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const startedAt = performance.now();
  const sourceSampleRate = audioContext.sampleRate;

  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  await new Promise((resolve) => window.setTimeout(resolve, recordingMs));

  processor.disconnect();
  source.disconnect();
  stream.getTracks().forEach((track) => track.stop());
  await audioContext.close();

  const merged = mergeChunks(chunks);
  if (merged.length === 0) {
    throw new Error("No microphone audio was captured. Check the microphone permission and try again.");
  }

  const resampled = resampleLinear(merged, sourceSampleRate, TARGET_SAMPLE_RATE);
  const wav = encodePcm16Wav(resampled, TARGET_SAMPLE_RATE);

  return {
    audioBase64: arrayBufferToBase64(wav),
    mimeType: "audio/wav",
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export function createSoraniSpeechAdapter(options: SoraniSpeechAdapterOptions = {}): AssistantSpeechAdapter {
  const recordingMs = options.recordingMs ?? DEFAULT_RECORDING_MS;

  return {
    isAvailable: () => Boolean(cachedAvailability?.available),
    getAvailability: getSoraniSpeechAvailability,
    startSoraniDictation: async (): Promise<AssistantSpeechTranscript> => {
      const availability = await getSoraniSpeechAvailability(true);
      if (!availability.available) {
        throw new Error(availability.message || UNAVAILABLE_MESSAGE);
      }

      const audio = await recordSoraniQuestion(recordingMs);
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<SoraniAsrTranscriptionResponse>("atlas_assistant_transcribe_sorani", {
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
      });

      const transcript = result.transcript?.trim();
      if (!transcript) {
        throw new Error("The local Sorani voice model did not return any text. Try again closer to the microphone.");
      }

      return {
        transcript,
        language: result.language ?? "ckb",
        confidence: result.confidence ?? null,
        durationMs: result.durationMs ?? audio.durationMs,
        engine: result.engine ?? null,
      };
    },
  };
}

export const unavailableSoraniSpeechAdapter: AssistantSpeechAdapter = {
  isAvailable: () => false,
  getAvailability: async () => unavailable("engine_not_installed"),
  startSoraniDictation: async () => {
    throw new Error(UNAVAILABLE_MESSAGE);
  },
};
