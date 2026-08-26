import { supabase } from "@/auth/supabase";

export const VOICE_STORAGE_BUCKET = "voice";

export type UploadedFlacVoice = {
  path: string;
};

function assertSafeStoragePath(path: string) {
  if (!path || path.startsWith("/") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Voice storage path is invalid.");
  }
}

export async function assertFlacAudio(blob: Blob) {
  if (blob.type !== "audio/flac") throw new Error("Voice recording must be a FLAC file.");
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature.length !== 4 || signature[0] !== 0x66 || signature[1] !== 0x4c || signature[2] !== 0x61 || signature[3] !== 0x43) {
    throw new Error("Voice recording is not a valid FLAC file.");
  }
}

/**
 * Upload a verified FLAC object to a caller-owned path. Authorization remains
 * with the bucket's RLS policy, so modules can share this safely without a
 * delivery-specific storage client.
 */
export async function uploadFlacVoice(input: {
  path: string;
  blob: Blob;
  bucket?: string;
  cacheControl?: string;
}): Promise<UploadedFlacVoice> {
  assertSafeStoragePath(input.path);
  await assertFlacAudio(input.blob);
  const pathSegments = input.path.split("/");
  const fileName = pathSegments[pathSegments.length - 1] ?? "recording.flac";
  const file = new File([input.blob], fileName, { type: "audio/flac" });
  const bucket = input.bucket ?? VOICE_STORAGE_BUCKET;
  const { error } = await supabase.storage.from(bucket).upload(input.path, file, {
    contentType: "audio/flac",
    cacheControl: input.cacheControl ?? "private, max-age=0",
    upsert: false,
  });
  if (error) {
    // A timeout can occur after the object reached Storage. Best-effort cleanup
    // keeps retries collision-safe without claiming an upload succeeded.
    await supabase.storage.from(bucket).remove([input.path]).catch(() => undefined);
    throw new Error("Could not upload the voice recording.");
  }
  return { path: input.path };
}

export async function deleteVoiceStorageObjects(paths: readonly string[], bucket = VOICE_STORAGE_BUCKET) {
  const uniquePaths = [...new Set(paths.filter((path) => typeof path === "string" && path.length > 0))];
  if (uniquePaths.length === 0) return;
  uniquePaths.forEach(assertSafeStoragePath);
  const { error } = await supabase.storage.from(bucket).remove(uniquePaths);
  if (error) throw new Error("Could not delete the voice recording.");
}

export async function downloadVoiceStorageObject(path: string, bucket = VOICE_STORAGE_BUCKET) {
  assertSafeStoragePath(path);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error("Could not retrieve the voice recording.");
  return data;
}
