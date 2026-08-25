import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mic, RotateCcw, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useFlacVoiceRecorder, type FlacVoiceRecording } from "@/hooks/useFlacVoiceRecorder";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { FlacAudioPlayer } from "./FlacAudioPlayer";

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type UploadState = "idle" | "uploading" | "uploaded" | "error";

export function VoiceReasonRecorder({
  onUpload,
  onDiscard,
  onBusyChange,
  disabled = false,
}: {
  onUpload: (recording: FlacVoiceRecording) => Promise<void>;
  onDiscard: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const recorder = useFlacVoiceRecorder();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState(false);
  const isBusy = disabled || recorder.status === "requesting" || recorder.status === "recording" || recorder.status === "encoding" || uploadState === "uploading";

  useEffect(() => {
    onBusyChange(isBusy);
  }, [isBusy, onBusyChange]);

  const upload = async (recording: FlacVoiceRecording) => {
    setUploadError(false);
    setUploadState("uploading");
    try {
      await onUpload(recording);
      setUploadState("uploaded");
    } catch (error) {
      console.error("[Post Service] Failed to upload voice reason:", error);
      setUploadError(true);
      setUploadState("error");
    }
  };

  const discard = async () => {
    if (uploadState === "uploaded") {
      try {
        setUploadState("uploading");
        await onDiscard();
      } catch (error) {
        console.error("[Post Service] Failed to discard voice reason:", error);
        setUploadError(true);
        setUploadState("error");
        return false;
      }
    }
    recorder.discard();
    setUploadError(false);
    setUploadState("idle");
    return true;
  };

  const start = async () => {
    if (recorder.recording && !(await discard())) return;
    await recorder.start();
  };

  const stop = async () => {
    const recording = await recorder.stop();
    if (recording) await upload(recording);
  };

  const recorderError = recorder.errorCode ? t(`postService.voiceReason.errors.${recorder.errorCode}`) : null;

  return <section className="rounded-xl border bg-muted/15 p-4" aria-live="polite">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-medium">{t("postService.voiceReason.voiceRecording")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("postService.voiceReason.voiceRecordingDescription")}</p>
      </div>
      {uploadState === "uploaded" && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />{t("postService.voiceReason.saved")}</span>}
    </div>

    {recorder.status === "recording" && <div className="mt-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
      <span className="font-medium">{t("postService.voiceReason.recording")}</span>
      <span className="ms-auto tabular-nums">{formatDuration(recorder.durationMs)}</span>
    </div>}

    {(recorder.status === "requesting" || recorder.status === "encoding" || uploadState === "uploading") && <div className="mt-4 flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{recorder.status === "encoding" ? t("postService.voiceReason.encoding") : uploadState === "uploading" ? t("postService.voiceReason.uploading") : t("postService.voiceReason.requestingMicrophone")}</div>}

    {(recorderError || uploadError) && <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{recorderError ?? t("postService.voiceReason.errors.uploadFailed")}</div>}

    {recorder.recording && <div className="mt-4"><FlacAudioPlayer source={{ kind: "blob", blob: recorder.recording.blob }} /></div>}

    <div className="mt-4 flex flex-wrap gap-2">
      {recorder.status === "recording" ? (
        <Button type="button" className="min-h-11 gap-2" variant="destructive" onClick={() => void stop()} aria-label={t("postService.voiceReason.stopRecording")}><Square className="h-4 w-4" />{t("postService.voiceReason.stopRecording")}</Button>
      ) : recorder.recording ? <>
        <Button type="button" className="min-h-11 gap-2" variant="outline" disabled={isBusy} onClick={() => void start()}><RotateCcw className="h-4 w-4" />{t("postService.voiceReason.reRecord")}</Button>
        <Button type="button" className="min-h-11 gap-2" variant="ghost" disabled={isBusy} onClick={() => void discard()}><Trash2 className="h-4 w-4" />{t("postService.voiceReason.deleteRecording")}</Button>
        {uploadState === "error" && <Button type="button" className="min-h-11" variant="outline" disabled={isBusy} onClick={() => recorder.recording && void upload(recorder.recording)}>{t("postService.voiceReason.retryUpload")}</Button>}
      </> : (
        <Button type="button" className={cn("min-h-11 gap-2", recorder.status === "error" && "border-destructive/40 text-destructive hover:text-destructive")} disabled={isBusy} onClick={() => void start()} aria-label={t("postService.voiceReason.startRecording")}><Mic className="h-4 w-4" />{t("postService.voiceReason.startRecording")}</Button>
      )}
    </div>
  </section>;
}
