import { db } from '@/local-db/database'
import type { WorkspaceUsageStatus } from '@/lib/workspaceUsage'

const LEGACY_WORKSPACE_USAGE_HISTORY_KEY = 'workspace_usage_history:v1'
const WORKSPACE_USAGE_HISTORY_KEY = 'workspace_usage_history:v2'
const WORKSPACE_USAGE_HISTORY_VERSION = 2
const MAX_CHART_DAYS = 30
// Keep one extra cumulative snapshot as the baseline for the first chart day.
// It is not graphed, and all snapshots are still deleted at period rollover.
const MAX_STORED_SNAPSHOT_DAYS = MAX_CHART_DAYS + 1
const DAY_MS = 24 * 60 * 60 * 1000

export type WorkspaceUsageDailySnapshot = {
    date: string
    actualTransferBytes: number
    chargedUsageBytes: number
}

export type WorkspaceUsageLocalHistory = {
    workspaceId: string
    transferPeriodStart: string
    trackedFrom: string
    lastSampleAt: string
    latestActualTransferBytes: number
    latestChargedUsageBytes: number
    dailySnapshots: WorkspaceUsageDailySnapshot[]
}

type WorkspaceUsageHistoryStore = {
    version: 2
    transferPeriodStart: string
    workspaces: Record<string, WorkspaceUsageLocalHistory>
}

export type WorkspaceUsageChartPoint = {
    date: string
    actualTransferBytes: number
    chargedUsageBytes: number
    cumulativeActualTransferBytes: number
    cumulativeChargedUsageBytes: number
}

export type WorkspaceUsageInsights = {
    averageDailyChargedUsageBytes: number
    projectedChargedUsageBytes: number
    remainingChargedUsageBytes: number | null
    dailyChargedUsageBudgetBytes: number | null
    peakDailyChargedUsageBytes: number
    observedChargedUsageBytes: number
    averageDailyActualTransferBytes: number
    projectedActualTransferBytes: number
    peakDailyActualTransferBytes: number
    observedActualTransferBytes: number
    daysElapsed: number
    daysRemaining: number
    periodDays: number
    nextPeriodStart: string
    trackedFrom: string | null
    lastUpdatedAt: string | null
    chartData: WorkspaceUsageChartPoint[]
}

let historyWriteQueue: Promise<void> = Promise.resolve()

function runHistoryWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = historyWriteQueue
        .catch(() => undefined)
        .then(operation)
    historyWriteQueue = result.then(() => undefined, () => undefined)
    return result
}

function normalizeByteCount(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function parseStoredByteCount(value: unknown): number | null {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
}

function isDayKey(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(parsed.getTime()) && toUtcDayKey(parsed) === value
}

function toUtcDayKey(date: Date): string {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('-')
}

function parseUtcDay(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`)
}

function addUtcDays(day: string, amount: number): string {
    const date = parseUtcDay(day)
    date.setUTCDate(date.getUTCDate() + amount)
    return toUtcDayKey(date)
}

function differenceInUtcDays(laterDay: string, earlierDay: string): number {
    return Math.round((parseUtcDay(laterDay).getTime() - parseUtcDay(earlierDay).getTime()) / DAY_MS)
}

function getNextPeriodStart(periodStart: string): string {
    const start = parseUtcDay(periodStart)
    return toUtcDayKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)))
}

function parseLocalHistory(
    workspaceId: string,
    transferPeriodStart: string,
    value: unknown
): WorkspaceUsageLocalHistory | null {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<WorkspaceUsageLocalHistory>
    if (candidate.workspaceId !== workspaceId || candidate.transferPeriodStart !== transferPeriodStart) return null
    if (!isTimestamp(candidate.trackedFrom) || !isTimestamp(candidate.lastSampleAt)) return null

    const latestActualTransferBytes = parseStoredByteCount(candidate.latestActualTransferBytes)
    const latestChargedUsageBytes = parseStoredByteCount(candidate.latestChargedUsageBytes)
    if (latestActualTransferBytes === null || latestChargedUsageBytes === null) return null
    if (!Array.isArray(candidate.dailySnapshots) || candidate.dailySnapshots.length === 0) return null

    const dailySnapshots: WorkspaceUsageDailySnapshot[] = []
    const seenDays = new Set<string>()
    for (const snapshot of candidate.dailySnapshots) {
        if (!snapshot || typeof snapshot !== 'object') return null
        const entry = snapshot as Partial<WorkspaceUsageDailySnapshot>
        const actualTransferBytes = parseStoredByteCount(entry.actualTransferBytes)
        const chargedUsageBytes = parseStoredByteCount(entry.chargedUsageBytes)
        if (
            !isDayKey(entry.date)
            || entry.date < transferPeriodStart
            || seenDays.has(entry.date)
            || actualTransferBytes === null
            || chargedUsageBytes === null
            || actualTransferBytes > latestActualTransferBytes
            || chargedUsageBytes > latestChargedUsageBytes
        ) return null
        seenDays.add(entry.date)
        dailySnapshots.push({
            date: entry.date,
            actualTransferBytes,
            chargedUsageBytes
        })
    }
    dailySnapshots.sort((left, right) => left.date.localeCompare(right.date))
    const latestSnapshot = dailySnapshots.at(-1)
    if (
        !latestSnapshot
        || latestSnapshot.actualTransferBytes !== latestActualTransferBytes
        || latestSnapshot.chargedUsageBytes !== latestChargedUsageBytes
    ) return null

    return {
        workspaceId,
        transferPeriodStart,
        trackedFrom: candidate.trackedFrom,
        lastSampleAt: candidate.lastSampleAt,
        latestActualTransferBytes,
        latestChargedUsageBytes,
        dailySnapshots
    }
}

function parseHistoryStore(value: string): WorkspaceUsageHistoryStore | null {
    try {
        const parsed = JSON.parse(value) as Partial<WorkspaceUsageHistoryStore>
        if (parsed.version !== WORKSPACE_USAGE_HISTORY_VERSION || !isDayKey(parsed.transferPeriodStart)) {
            return null
        }
        if (!parsed.workspaces || typeof parsed.workspaces !== 'object' || Array.isArray(parsed.workspaces)) {
            return null
        }

        const workspaces: Record<string, WorkspaceUsageLocalHistory> = {}
        for (const [workspaceId, history] of Object.entries(parsed.workspaces)) {
            const normalized = parseLocalHistory(workspaceId, parsed.transferPeriodStart, history)
            if (!normalized) return null
            workspaces[workspaceId] = normalized
        }

        return {
            version: WORKSPACE_USAGE_HISTORY_VERSION,
            transferPeriodStart: parsed.transferPeriodStart,
            workspaces
        }
    } catch {
        return null
    }
}

async function loadHistoryStore(): Promise<{ exists: boolean; store: WorkspaceUsageHistoryStore | null }> {
    const row = await db.app_settings.get(WORKSPACE_USAGE_HISTORY_KEY)
    return {
        exists: Boolean(row),
        store: row ? parseHistoryStore(row.value) : null
    }
}

async function persistHistoryStore(store: WorkspaceUsageHistoryStore): Promise<void> {
    await db.app_settings.put({
        key: WORKSPACE_USAGE_HISTORY_KEY,
        value: JSON.stringify(store)
    })
}

async function deleteHistoryStore(): Promise<void> {
    await db.app_settings.delete(WORKSPACE_USAGE_HISTORY_KEY)
}

async function deleteLegacyHistoryStore(): Promise<void> {
    const legacyRow = await db.app_settings.get(LEGACY_WORKSPACE_USAGE_HISTORY_KEY)
    if (legacyRow) {
        await db.app_settings.delete(LEGACY_WORKSPACE_USAGE_HISTORY_KEY)
    }
}

export function saveWorkspaceUsageSnapshot(
    status: WorkspaceUsageStatus,
    now = new Date()
): Promise<WorkspaceUsageLocalHistory | null> {
    return runHistoryWrite(async () => {
        // v1 stored one ambiguous counter that represented raw transfer before charging was introduced.
        // It cannot be safely reinterpreted as charged usage, so remove it instead of migrating it.
        await deleteLegacyHistoryStore()

        if (!status.workspace_id || !isDayKey(status.transfer_period_start)) return null

        const { exists, store: loadedStore } = await loadHistoryStore()
        let store = loadedStore

        if (exists && (!store || store.transferPeriodStart !== status.transfer_period_start)) {
            // The row is corrupt or belongs to an old billing period. Delete it before rebuilding.
            await deleteHistoryStore()
            store = null
        }

        if (!status.has_limits) {
            if (!store) return null
            delete store.workspaces[status.workspace_id]
            if (Object.keys(store.workspaces).length === 0) {
                await deleteHistoryStore()
            } else {
                await persistHistoryStore(store)
            }
            return null
        }

        if (!store) {
            store = {
                version: WORKSPACE_USAGE_HISTORY_VERSION,
                transferPeriodStart: status.transfer_period_start,
                workspaces: {}
            }
        }

        const sampleAt = now.toISOString()
        const sampleDay = toUtcDayKey(now)
        // These counters intentionally remain separate: actual is the network payload size, while
        // charged is the quota consumption after applying transfer_charge_multiplier on the server.
        const actualTransferBytes = normalizeByteCount(status.actual_data_transfer_bytes)
        const chargedUsageBytes = normalizeByteCount(status.data_transfer_bytes)
        const earliestKeptDay = [status.transfer_period_start, addUtcDays(sampleDay, -(MAX_STORED_SNAPSHOT_DAYS - 1))]
            .sort()
            .at(-1) as string
        const existing = store.workspaces[status.workspace_id]
        const counterWasReset = Boolean(existing && (
            existing.latestActualTransferBytes > actualTransferBytes
            || existing.latestChargedUsageBytes > chargedUsageBytes
        ))
        const snapshots = counterWasReset ? [] : (existing?.dailySnapshots ?? [])
        const snapshotByDay = new Map(
            snapshots
                .filter((snapshot) => snapshot.date >= earliestKeptDay && snapshot.date <= sampleDay)
                .map((snapshot) => [snapshot.date, snapshot])
        )
        snapshotByDay.set(sampleDay, {
            date: sampleDay,
            actualTransferBytes,
            chargedUsageBytes
        })

        const history: WorkspaceUsageLocalHistory = {
            workspaceId: status.workspace_id,
            transferPeriodStart: status.transfer_period_start,
            trackedFrom: counterWasReset || !existing ? sampleAt : existing.trackedFrom,
            lastSampleAt: sampleAt,
            latestActualTransferBytes: actualTransferBytes,
            latestChargedUsageBytes: chargedUsageBytes,
            dailySnapshots: Array.from(snapshotByDay.values())
                .sort((left, right) => left.date.localeCompare(right.date))
        }

        store.workspaces[status.workspace_id] = history
        await persistHistoryStore(store)
        return history
    })
}

export function buildWorkspaceUsageInsights(
    status: WorkspaceUsageStatus,
    history: WorkspaceUsageLocalHistory | null,
    now = new Date()
): WorkspaceUsageInsights {
    const today = toUtcDayKey(now)
    const periodStart = isDayKey(status.transfer_period_start)
        ? status.transfer_period_start
        : `${today.slice(0, 8)}01`
    const nextPeriodStart = getNextPeriodStart(periodStart)
    const periodDays = Math.max(1, differenceInUtcDays(nextPeriodStart, periodStart))
    const rawElapsedDays = differenceInUtcDays(today, periodStart) + 1
    const daysElapsed = Math.min(periodDays, Math.max(1, rawElapsedDays))
    const daysRemaining = Math.max(0, periodDays - daysElapsed)
    const currentActualTransferBytes = normalizeByteCount(status.actual_data_transfer_bytes)
    const currentChargedUsageBytes = normalizeByteCount(status.data_transfer_bytes)
    const chargedUsageLimit = status.monthly_data_transfer_limit_bytes === null
        ? null
        : normalizeByteCount(status.monthly_data_transfer_limit_bytes)
    const averageDailyChargedUsageBytes = currentChargedUsageBytes / daysElapsed
    const projectedChargedUsageBytes = Math.round(averageDailyChargedUsageBytes * periodDays)
    const remainingChargedUsageBytes = chargedUsageLimit === null
        ? null
        : Math.max(0, chargedUsageLimit - currentChargedUsageBytes)
    const dailyChargedUsageBudgetBytes = remainingChargedUsageBytes === null || daysRemaining <= 0
        ? null
        : remainingChargedUsageBytes / daysRemaining
    const averageDailyActualTransferBytes = currentActualTransferBytes / daysElapsed
    const projectedActualTransferBytes = Math.round(averageDailyActualTransferBytes * periodDays)
    const matchingHistory = history?.workspaceId === status.workspace_id
        && history.transferPeriodStart === periodStart
        ? history
        : null
    const effectiveHistory = matchingHistory
        && matchingHistory.latestActualTransferBytes <= currentActualTransferBytes
        && matchingHistory.latestChargedUsageBytes <= currentChargedUsageBytes
        ? matchingHistory
        : null
    const snapshots = (effectiveHistory?.dailySnapshots ?? [])
        .filter((snapshot) => snapshot.date >= periodStart && snapshot.date <= today)
        .sort((left, right) => left.date.localeCompare(right.date))
    const dailyConsumption = new Map<string, {
        actualTransferBytes: number
        chargedUsageBytes: number
        cumulativeActualTransferBytes: number
        cumulativeChargedUsageBytes: number
    }>()
    let previousCumulativeActualTransferBytes = 0
    let previousCumulativeChargedUsageBytes = 0
    let hasCumulativeBaseline = false

    for (const snapshot of snapshots) {
        const cumulativeActualTransferBytes = Math.max(
            previousCumulativeActualTransferBytes,
            normalizeByteCount(snapshot.actualTransferBytes)
        )
        const cumulativeChargedUsageBytes = Math.max(
            previousCumulativeChargedUsageBytes,
            normalizeByteCount(snapshot.chargedUsageBytes)
        )
        dailyConsumption.set(snapshot.date, {
            // A cumulative sample can be converted to daily usage only when a
            // previous sample exists. The period's first day has an implicit zero
            // baseline; a first-ever mid-period sample is baseline-only so it does
            // not invent a large spike.
            actualTransferBytes: hasCumulativeBaseline || snapshot.date === periodStart
                ? Math.max(0, cumulativeActualTransferBytes - previousCumulativeActualTransferBytes)
                : 0,
            chargedUsageBytes: hasCumulativeBaseline || snapshot.date === periodStart
                ? Math.max(0, cumulativeChargedUsageBytes - previousCumulativeChargedUsageBytes)
                : 0,
            cumulativeActualTransferBytes,
            cumulativeChargedUsageBytes
        })
        previousCumulativeActualTransferBytes = cumulativeActualTransferBytes
        previousCumulativeChargedUsageBytes = cumulativeChargedUsageBytes
        hasCumulativeBaseline = true
    }

    if ((effectiveHistory !== null || today === periodStart) && (
        currentActualTransferBytes > previousCumulativeActualTransferBytes
        || currentChargedUsageBytes > previousCumulativeChargedUsageBytes
    )) {
        const currentDay = dailyConsumption.get(today)
        dailyConsumption.set(today, {
            actualTransferBytes: (currentDay?.actualTransferBytes ?? 0)
                + Math.max(0, currentActualTransferBytes - previousCumulativeActualTransferBytes),
            chargedUsageBytes: (currentDay?.chargedUsageBytes ?? 0)
                + Math.max(0, currentChargedUsageBytes - previousCumulativeChargedUsageBytes),
            cumulativeActualTransferBytes: Math.max(
                currentDay?.cumulativeActualTransferBytes ?? 0,
                currentActualTransferBytes
            ),
            cumulativeChargedUsageBytes: Math.max(
                currentDay?.cumulativeChargedUsageBytes ?? 0,
                currentChargedUsageBytes
            )
        })
    }

    const chartStart = [periodStart, addUtcDays(today, -(MAX_CHART_DAYS - 1))]
        .sort()
        .at(-1) as string
    const chartData: WorkspaceUsageChartPoint[] = []
    let chartDay = chartStart
    let lastCumulativeActualTransferBytes = 0
    let lastCumulativeChargedUsageBytes = 0
    for (const [date, consumption] of dailyConsumption) {
        if (date >= chartStart) break
        lastCumulativeActualTransferBytes = consumption.cumulativeActualTransferBytes
        lastCumulativeChargedUsageBytes = consumption.cumulativeChargedUsageBytes
    }
    while (chartDay <= today) {
        const consumption = dailyConsumption.get(chartDay)
        if (consumption) {
            lastCumulativeActualTransferBytes = consumption.cumulativeActualTransferBytes
            lastCumulativeChargedUsageBytes = consumption.cumulativeChargedUsageBytes
        }
        chartData.push({
            date: chartDay,
            actualTransferBytes: consumption?.actualTransferBytes ?? 0,
            chargedUsageBytes: consumption?.chargedUsageBytes ?? 0,
            cumulativeActualTransferBytes: lastCumulativeActualTransferBytes,
            cumulativeChargedUsageBytes: lastCumulativeChargedUsageBytes
        })
        chartDay = addUtcDays(chartDay, 1)
    }

    return {
        averageDailyChargedUsageBytes,
        projectedChargedUsageBytes,
        remainingChargedUsageBytes,
        dailyChargedUsageBudgetBytes,
        peakDailyChargedUsageBytes: chartData.reduce(
            (peak, point) => Math.max(peak, point.chargedUsageBytes),
            0
        ),
        observedChargedUsageBytes: chartData.reduce(
            (total, point) => total + point.chargedUsageBytes,
            0
        ),
        averageDailyActualTransferBytes,
        projectedActualTransferBytes,
        peakDailyActualTransferBytes: chartData.reduce(
            (peak, point) => Math.max(peak, point.actualTransferBytes),
            0
        ),
        observedActualTransferBytes: chartData.reduce(
            (total, point) => total + point.actualTransferBytes,
            0
        ),
        daysElapsed,
        daysRemaining,
        periodDays,
        nextPeriodStart,
        trackedFrom: effectiveHistory?.trackedFrom ?? null,
        lastUpdatedAt: effectiveHistory?.lastSampleAt ?? null,
        chartData
    }
}

export const workspaceUsageHistoryInternals = {
    storageKey: WORKSPACE_USAGE_HISTORY_KEY,
    legacyStorageKey: LEGACY_WORKSPACE_USAGE_HISTORY_KEY,
    version: WORKSPACE_USAGE_HISTORY_VERSION,
    toUtcDayKey
}
