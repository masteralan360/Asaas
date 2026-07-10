import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceUsageStatus } from './workspaceUsage'

const appSettingsMock = vi.hoisted(() => {
    const rows = new Map<string, string>()
    const table = {
        get: vi.fn(async (key: string) => {
            const value = rows.get(key)
            return value === undefined ? undefined : { key, value }
        }),
        put: vi.fn(async (row: { key: string; value: string }) => {
            rows.set(row.key, row.value)
        }),
        delete: vi.fn(async (key: string) => {
            rows.delete(key)
        })
    }

    return {
        rows,
        table,
        reset() {
            rows.clear()
            table.get.mockClear()
            table.put.mockClear()
            table.delete.mockClear()
        }
    }
})

vi.mock('@/local-db/database', () => ({
    db: {
        app_settings: appSettingsMock.table
    }
}))

import {
    buildWorkspaceUsageInsights,
    saveWorkspaceUsageSnapshot,
    workspaceUsageHistoryInternals
} from './workspaceUsageHistory'

const workspaceId = '2f3c9c52-1d56-42d0-9643-a381f14bac6d'
const secondWorkspaceId = 'f33a3adc-5507-4f6a-9ee1-27e75d00bd21'

function usageStatus(overrides: Partial<WorkspaceUsageStatus> = {}): WorkspaceUsageStatus {
    return {
        workspace_id: workspaceId,
        has_limits: true,
        storage_units: 25,
        storage_unit_limit: 100,
        data_transfer_bytes: 0,
        monthly_data_transfer_limit_bytes: 10_000,
        transfer_period_start: '2026-07-01',
        ...overrides
    }
}

describe('local workspace usage history', () => {
    beforeEach(() => {
        appSettingsMock.reset()
    })

    it('stores cumulative daily snapshots and computes local daily consumption', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 1_500 }),
            new Date('2026-07-02T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            usageStatus({ data_transfer_bytes: 1_500 }),
            history,
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(history?.dailySnapshots).toEqual([
            { date: '2026-07-01', transferBytes: 1_000 },
            { date: '2026-07-02', transferBytes: 1_500 }
        ])
        expect(insights.chartData.map((point) => point.transferBytes)).toEqual([1_000, 500])
        expect(insights.averageDailyBytes).toBe(750)
        expect(insights.projectedTransferBytes).toBe(23_250)
        expect(insights.remainingTransferBytes).toBe(8_500)
        expect(insights.daysRemaining).toBe(29)
        expect(insights.observedTransferBytes).toBe(1_500)
    })

    it('deletes every old workspace detail when the transfer period changes', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ transfer_period_start: '2026-06-01', data_transfer_bytes: 800 }),
            new Date('2026-06-20T12:00:00.000Z')
        )
        await saveWorkspaceUsageSnapshot(
            usageStatus({
                workspace_id: secondWorkspaceId,
                transfer_period_start: '2026-06-01',
                data_transfer_bytes: 400
            }),
            new Date('2026-06-20T12:05:00.000Z')
        )

        const julyHistory = await saveWorkspaceUsageSnapshot(
            usageStatus({ transfer_period_start: '2026-07-01', data_transfer_bytes: 50 }),
            new Date('2026-07-01T01:00:00.000Z')
        )
        const stored = JSON.parse(String(appSettingsMock.rows.get(workspaceUsageHistoryInternals.storageKey)))

        expect(appSettingsMock.table.delete).toHaveBeenCalledWith(workspaceUsageHistoryInternals.storageKey)
        expect(stored.transferPeriodStart).toBe('2026-07-01')
        expect(Object.keys(stored.workspaces)).toEqual([workspaceId])
        expect(julyHistory?.dailySnapshots).toEqual([{ date: '2026-07-01', transferBytes: 50 }])
    })

    it('drops stale snapshots when the server counter is reset in the same period', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 1_250 }),
            new Date('2026-07-02T12:00:00.000Z')
        )
        const resetHistory = await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 100 }),
            new Date('2026-07-03T12:00:00.000Z')
        )

        expect(resetHistory?.dailySnapshots).toEqual([{ date: '2026-07-03', transferBytes: 100 }])
        expect(resetHistory?.latestTransferBytes).toBe(100)
        expect(resetHistory?.trackedFrom).toBe('2026-07-03T12:00:00.000Z')
    })

    it('keeps no more than the current period portion of the last 30 days', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 100 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 500 }),
            new Date('2026-07-31T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            usageStatus({ data_transfer_bytes: 500 }),
            history,
            new Date('2026-07-31T12:00:00.000Z')
        )

        expect(history?.dailySnapshots).toEqual([{ date: '2026-07-31', transferBytes: 500 }])
        expect(insights.chartData).toHaveLength(30)
        expect(insights.chartData[0]?.date).toBe('2026-07-02')
        expect(insights.chartData.at(-1)?.date).toBe('2026-07-31')
    })

    it('removes local details when workspace usage limits are disabled', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )

        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ has_limits: false, data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:01:00.000Z')
        )

        expect(history).toBeNull()
        expect(appSettingsMock.rows.has(workspaceUsageHistoryInternals.storageKey)).toBe(false)
    })

    it('deletes corrupt local history before saving a clean sample', async () => {
        appSettingsMock.rows.set(workspaceUsageHistoryInternals.storageKey, '{invalid')

        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ data_transfer_bytes: 300 }),
            new Date('2026-07-01T12:00:00.000Z')
        )

        expect(appSettingsMock.table.delete).toHaveBeenCalledWith(workspaceUsageHistoryInternals.storageKey)
        expect(history?.latestTransferBytes).toBe(300)
    })
})
