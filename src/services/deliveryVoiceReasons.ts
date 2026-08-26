import { generateId } from "@/lib/utils";
import {
  deleteVoiceStorageObjects,
  downloadVoiceStorageObject,
  uploadFlacVoice,
  VOICE_STORAGE_BUCKET,
} from "@/services/voiceStorage";

export { getPostponedVoiceReasonCleanupPaths } from "@/lib/deliveryVoiceReasonPaths";

export const DELIVERY_VOICE_BUCKET = VOICE_STORAGE_BUCKET;
export type DeliveryVoiceReasonStatus = "returned" | "postponed";

export type UploadedDeliveryVoiceReason = {
  path: string;
  durationMs: number;
};

function voiceReasonPath(workspaceId: string, shipmentId: string, status: DeliveryVoiceReasonStatus, recordingId: string) {
  return `${workspaceId}/${shipmentId}/${status}/${recordingId}.flac`;
}

export async function uploadDeliveryVoiceReason(input: {
  workspaceId: string;
  shipmentId: string;
  status: DeliveryVoiceReasonStatus;
  recordingId?: string;
  blob: Blob;
  durationMs: number;
}): Promise<UploadedDeliveryVoiceReason> {
  if (!Number.isInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 1_800_000) {
    throw new Error("Voice recording duration is invalid.");
  }
  const path = voiceReasonPath(input.workspaceId, input.shipmentId, input.status, input.recordingId ?? generateId());
  await uploadFlacVoice({ path, blob: input.blob, bucket: DELIVERY_VOICE_BUCKET });
  return { path, durationMs: input.durationMs };
}

export async function deleteDeliveryVoiceReason(path: string) {
  return deleteDeliveryVoiceReasons([path]);
}

/** Delete only authenticated, private `voice` objects through Storage API. */
export async function deleteDeliveryVoiceReasons(paths: readonly string[]) {
  await deleteVoiceStorageObjects(paths, DELIVERY_VOICE_BUCKET);
}

export async function downloadDeliveryVoiceReason(path: string) {
  return downloadVoiceStorageObject(path, DELIVERY_VOICE_BUCKET);
}
