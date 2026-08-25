import { supabase } from "@/auth/supabase";
import { generateId } from "@/lib/utils";

export { getPostponedVoiceReasonCleanupPaths } from "@/lib/deliveryVoiceReasonPaths";

export const DELIVERY_VOICE_BUCKET = "voice";
export type DeliveryVoiceReasonStatus = "returned" | "postponed";

export type UploadedDeliveryVoiceReason = {
  path: string;
  durationMs: number;
};

function voiceReasonPath(workspaceId: string, shipmentId: string, status: DeliveryVoiceReasonStatus, recordingId: string) {
  return `${workspaceId}/${shipmentId}/${status}/${recordingId}.flac`;
}

async function assertFlac(blob: Blob) {
  if (blob.type !== "audio/flac") throw new Error("Voice reason must be a FLAC recording.");
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature.length !== 4 || signature[0] !== 0x66 || signature[1] !== 0x4c || signature[2] !== 0x61 || signature[3] !== 0x43) {
    throw new Error("Voice reason is not a valid FLAC recording.");
  }
}

export async function uploadDeliveryVoiceReason(input: {
  workspaceId: string;
  shipmentId: string;
  status: DeliveryVoiceReasonStatus;
  recordingId?: string;
  blob: Blob;
  durationMs: number;
}): Promise<UploadedDeliveryVoiceReason> {
  await assertFlac(input.blob);
  if (!Number.isInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 1_800_000) {
    throw new Error("Voice recording duration is invalid.");
  }
  const path = voiceReasonPath(input.workspaceId, input.shipmentId, input.status, input.recordingId ?? generateId());
  const pathSegments = path.split("/");
  const fileName = pathSegments[pathSegments.length - 1] ?? "reason.flac";
  const file = new File([input.blob], fileName, { type: "audio/flac" });
  const { error } = await supabase.storage.from(DELIVERY_VOICE_BUCKET).upload(path, file, {
    contentType: "audio/flac",
    cacheControl: "private, max-age=0",
    upsert: false,
  });
  if (error) {
    // A rejected response can occur after a slow network request reached the
    // server. Remove this exact, private path before letting the user retry so
    // a failed upload cannot leave an accidentally reusable reference.
    await supabase.storage.from(DELIVERY_VOICE_BUCKET).remove([path]).catch(() => undefined);
    throw new Error("Could not upload the voice reason.");
  }
  return { path, durationMs: input.durationMs };
}

export async function deleteDeliveryVoiceReason(path: string) {
  return deleteDeliveryVoiceReasons([path]);
}

/** Delete only authenticated, private `voice` objects through Storage API. */
export async function deleteDeliveryVoiceReasons(paths: readonly string[]) {
  const uniquePaths = [...new Set(paths.filter((path) => typeof path === "string" && path.length > 0))];
  if (uniquePaths.length === 0) return;
  const { error } = await supabase.storage.from(DELIVERY_VOICE_BUCKET).remove(uniquePaths);
  if (error) throw new Error("Could not discard the voice reason.");
}

export async function downloadDeliveryVoiceReason(path: string) {
  const { data, error } = await supabase.storage.from(DELIVERY_VOICE_BUCKET).download(path);
  if (error || !data) throw new Error("Could not retrieve the voice recording.");
  return data;
}
