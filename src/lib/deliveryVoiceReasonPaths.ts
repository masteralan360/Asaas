/**
 * Accept only voice-reason paths generated for a postponed shipment. Keeping
 * this independent of the Storage client lets the offline sync engine verify
 * its queued cleanup payload without loading browser-only UI dependencies.
 */
export function getPostponedVoiceReasonCleanupPaths(input: {
  workspaceId: string;
  shipmentId: string;
  paths: unknown;
}) {
  const prefix = `${input.workspaceId}/${input.shipmentId}/postponed/`;
  const values = Array.isArray(input.paths) ? input.paths : [];
  return [...new Set(values.filter((path): path is string => (
    typeof path === "string"
    && path.startsWith(prefix)
    && path.endsWith(".flac")
  )))];
}
