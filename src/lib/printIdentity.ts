import { v5 as uuidv5 } from 'uuid'

// Stable namespace for report-like print origins that do not have their own table UUID.
const PRINT_ORIGIN_NAMESPACE = '6a67c996-9ac8-4c63-8b76-99cf9289962b'

export function getReportOriginId(
    workspaceId: string | null | undefined,
    origin: string,
    scope: string,
) {
    if (!workspaceId) return undefined
    return uuidv5(`${workspaceId}:${origin}:${scope}`, PRINT_ORIGIN_NAMESPACE)
}
