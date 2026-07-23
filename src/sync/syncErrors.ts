export const SCHEMA_MISMATCH_ERROR_PREFIX = "Schema mismatch:";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "Unknown error");
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function getSchemaMismatchColumnName(error?: string): string | null {
  if (typeof error !== "string") return null;
  const patterns = [
    /does not recognize (?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/i,
    /could not find the ['"]([^'"]+)['"] column/i,
    /column ['"]([^'"]+)['"](?: of relation ['"][^'"]+['"])? does not exist/i,
    /column ([a-z_][a-z0-9_]*) does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Returns an actionable, non-retrying queue error when PostgREST/Postgres
 * rejects a payload because the app and remote table schemas differ.
 */
export function getSchemaMismatchError(
  tableName: string,
  error: unknown,
): string | null {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const column = getSchemaMismatchColumnName(message);
  const isSchemaMismatch =
    code === "PGRST204" ||
    code === "42703" ||
    column !== null ||
    /schema cache/i.test(message) && /column/i.test(message);

  if (!isSchemaMismatch) return null;

  const target = column ? `${tableName}.${column}` : tableName;
  return `${SCHEMA_MISMATCH_ERROR_PREFIX} Supabase does not recognize ${target}. The queued change was kept locally and needs an explicit retry after the server schema is updated. Original error: ${message}`;
}

export function isSchemaMismatchError(error?: string): boolean {
  return typeof error === "string" && error.startsWith(SCHEMA_MISMATCH_ERROR_PREFIX);
}
