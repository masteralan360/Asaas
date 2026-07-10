import { db } from '@/local-db/database'
import type { WorkspaceUsageStatus } from '@/lib/workspaceUsage'

const WORKSPACE_USAGE_HISTORY_KEY = 'workspace_usage_history:v1'
const WORKSPACE_USAGE_HISTORY_VERSION = 1
const MAX_CHART_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type WorkspaceUsageDailySnapshot = {
    date: string
    transferBytes: number
}

export type WorkspaceUsageLocalHistory = {
    workspaceId: string
    transferPeriodStart: string
    trackedFrom: string
    lastSampleAt: string
    latestTransferBytes: number
    dailySnapshots: WorkspaceUsageDailySnapshot[]
}

type WorkspaceUsageHistoryStore = {
    version: 1
    transferPeriodStart: string
    workspaces: Record<string, WorkspaceUsageLocalHistory>
}

export type WorkspaceUsageChartPoint = {
    date: string
    transferBytes: number
    cumulativeBytes: number
}

export type WorkspaceUsageInsights = {
    averageDailyBytes: number
    projectedTransferBytes: number
    remainingTransferBytes: number | null
    dailyBudgetBytes: number | null
    peakDailyBytes: number
    observedTransferBytes: number
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
    if (typeof candidate.trackedFrom !== 'string' || typeof candidate.lastSampleAt !== 'string') return null

    const dailySnapshots = Array.isArray(candidate.dailySnapshots)
        ? candidate.dailySnapshots.flatMap((snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') return []
            const entry = snapshot as Partial<WorkspaceUsageDailySnapshot>
            if (!isDayKey(entry.date)) return []
            return [{
                date: entry.date,
                transferBytes: normalizeByteCount(entry.transferBytes)
            }]
        })
        : []

    return {
        workspaceId,
        transferPeriodStart,
        trackedFrom: candidate.trackedFrom,
        lastSampleAt: candidate.lastSampleAt,
        latestTransferBytes: normalizeByteCount(candidate.latestTransferBytes),
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
            if (normalized) workspaces[workspaceId] = normalized
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

export function saveWorkspaceUsageSnapshot(
    status: WorkspaceUsageStatus,
    now = new Date()
): Promise<WorkspaceUsageLocalHistory | null> {
    return runHistoryWrite(async () => {
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
        const transferBytes = normalizeByteCount(status.data_transfer_bytes)
        const earliestKeptDay = [status.transfer_period_start, addUtcDays(sampleDay, -(MAX_CHART_DAYS - 1))]
            .sort()
            .at(-1) as string
        const existing = store.workspaces[status.workspace_id]
        const counterWasReset = Boolean(existing && existing.latestTransferBytes > transferBytes)
        const snapshots = counterWasReset ? [] : (existing?.dailySnapshots ?? [])
        const snapshotByDay = new Map(
            snapshots
                .filter((snapshot) => snapshot.date >= earliestKeptDay && snapshot.date <= sampleDay)
                .map((snapshot) => [snapshot.date, snapshot.transferBytes])
        )
        snapshotByDay.set(sampleDay, transferBytes)

        const history: WorkspaceUsageLocalHistory = {
            workspaceId: status.workspace_id,
            transferPeriodStart: status.transfer_period_start,
            trackedFrom: counterWasReset || !existing ? sampleAt : existing.trackedFrom,
            lastSampleAt: sampleAt,
            latestTransferBytes: transferBytes,
            dailySnapshots: Array.from(snapshotByDay, ([date, bytes]) => ({
                date,
                transferBytes: bytes
            })).sort((left, right) => left.date.localeCompare(right.date))
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
    const currentTransferBytes = normalizeByteCount(status.data_transfer_bytes)
    const transferLimit = status.monthly_data_transfer_limit_bytes === null
        ? null
        : normalizeByteCount(status.monthly_data_transfer_limit_bytes)
    const averageDailyBytes = currentTransferBytes / daysElapsed
    const projectedTransferBytes = Math.round(averageDailyBytes * periodDays)
    const remainingTransferBytes = transferLimit === null
        ? null
        : Math.max(0, transferLimit - currentTransferBytes)
    const dailyBudgetBytes = remainingTransferBytes === null || daysRemaining <= 0
        ? null
        : remainingTransferBytes / daysRemaining
    const effectiveHistory = history?.workspaceId === status.workspace_id
        && history.transferPeriodStart === periodStart
        ? history
        : null
    const snapshots = (effectiveHistory?.dailySnapshots ?? [])
        .filter((snapshot) => snapshot.date >= periodStart && snapshot.date <= today)
        .sort((left, right) => left.date.localeCompare(right.date))
    const dailyConsumption = new Map<string, { bytes: number; cumulativeBytes: number }>()
    let previousCumulativeBytes = 0

    for (const snapshot of snapshots) {
        const cumulativeBytes = Math.max(previousCumulativeBytes, normalizeByteCount(snapshot.transferBytes))
        dailyConsumption.set(snapshot.date, {
            bytes: Math.max(0, cumulativeBytes - previousCumulativeBytes),
            cumulativeBytes
        })
        previousCumulativeBytes = cumulativeBytes
    }

    if (currentTransferBytes > previousCumulativeBytes) {
        const currentDay = dailyConsumption.get(today)
        dailyConsumption.set(today, {
            bytes: (currentDay?.bytes ?? 0) + currentTransferBytes - previousCumulativeBytes,
            cumulativeBytes: currentTransferBytes
        })
    }

    const chartStart = [periodStart, addUtcDays(today, -(MAX_CHART_DAYS - 1))]
        .sort()
        .at(-1) as string
    const chartData: WorkspaceUsageChartPoint[] = []
    let chartDay = chartStart
    let lastCumulativeBytes = 0
    while (chartDay <= today) {
        const consumption = dailyConsumption.get(chartDay)
        if (consumption) lastCumulativeBytes = consumption.cumulativeBytes
        chartData.push({
            date: chartDay,
            transferBytes: consumption?.bytes ?? 0,
            cumulativeBytes: lastCumulativeBytes
        })
        chartDay = addUtcDays(chartDay, 1)
    }

    return {
        averageDailyBytes,
        projectedTransferBytes,
        remainingTransferBytes,
        dailyBudgetBytes,
        peakDailyBytes: chartData.reduce((peak, point) => Math.max(peak, point.transferBytes), 0),
        observedTransferBytes: chartData.reduce((total, point) => total + point.transferBytes, 0),
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
    toUtcDayKey
}
