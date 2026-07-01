import { isSupabaseConfigured, supabase } from '@/auth/supabase'
import { isTauri } from '@/lib/platform'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'

type RecordTauriStartupVersionParams = {
    userId: string
    workspaceId: string
    version: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reportedStartupProfiles = new Set<string>()

function isUuid(value: string) {
    return UUID_PATTERN.test(value)
}

export async function recordTauriStartupVersion({
    userId,
    workspaceId,
    version
}: RecordTauriStartupVersionParams): Promise<void> {
    const normalizedVersion = version.trim()

    if (
        !isSupabaseConfigured ||
        !isTauri() ||
        !normalizedVersion ||
        !isUuid(userId) ||
        !isUuid(workspaceId)
    ) {
        return
    }

    if (reportedStartupProfiles.has(userId)) {
        return
    }
    reportedStartupProfiles.add(userId)

    try {
        const { error } = await runSupabaseAction(
            'tauriVersions.recordStartup',
            () => supabase.rpc('record_tauri_startup_version', {
                p_version: normalizedVersion
            }),
            { timeoutMs: 5000, platform: 'all' }
        ) as { error?: unknown }

        if (error) {
            throw error
        }
    } catch (error) {
        console.warn('[TauriVersion] Failed to record startup version:', normalizeSupabaseActionError(error))
    }
}
