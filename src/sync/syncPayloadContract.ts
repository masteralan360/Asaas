/**
 * Fields that exist in the local model but must never be included in an
 * ordinary table mutation. Keep this contract deliberately small and
 * explicit: a field is removed only when Atlas knows it is local-only or a
 * derived/legacy value. Everything else is sent to Supabase so a schema
 * mismatch remains visible instead of silently losing business data.
 */
const COMMON_NON_REMOTE_FIELDS = new Set([
  "sync_status",
  "last_synced_at",
]);

const NON_REMOTE_FIELDS_BY_ENTITY: Readonly<Record<string, ReadonlySet<string>>> = {
  products: new Set([
    "sku_key",
    // Product quantity is a local snapshot derived from inventory rows.
    "quantity",
    "storage_id",
    "storage_name",
    // Product barcodes live in product_barcodes.
    "barcode",
    "barcodes",
  ]),
  agents: new Set(["image_url"]),
  invoices: new Set([
    // Legacy/local invoice display and file fields.
    "items",
    "currency",
    "subtotal",
    "discount",
    "print_metadata",
    "is_snapshot",
    "customer_id",
    "status",
    "local_path_a4",
    "local_path_receipt",
    "pdf_blob_a4",
    "pdf_blob_receipt",
  ]),
  customers: new Set(["is_locked"]),
  suppliers: new Set(["is_locked"]),
};

// Development-only fault injection. Set VITE_DEBUG_FORCE_SYNC_SCHEMA_MISMATCH
// to "true" in a local .env.local file and restart the dev app to make the
// next queued product mutation include a deliberately invalid remote column.
// It is hard-disabled in production builds.
const FORCE_PRODUCT_SCHEMA_MISMATCH =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEBUG_FORCE_SYNC_SCHEMA_MISMATCH === "true";

function toSnakeCase(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in payload) {
    if (payload[key] === undefined) continue;
    result[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = payload[key];
  }
  return result;
}

export function prepareRemoteMutationPayload(
  entityType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const remotePayload = toSnakeCase(payload);
  const nonRemoteFields = NON_REMOTE_FIELDS_BY_ENTITY[entityType];

  for (const field of COMMON_NON_REMOTE_FIELDS) {
    delete remotePayload[field];
  }
  for (const field of nonRemoteFields ?? []) {
    delete remotePayload[field];
  }

  if (FORCE_PRODUCT_SCHEMA_MISMATCH && entityType === "products") {
    remotePayload.__debug_force_sync_schema_mismatch = true;
  }

  return remotePayload;
}
