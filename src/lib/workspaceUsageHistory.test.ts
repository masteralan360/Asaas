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
        actual_data_transfer_bytes: 0,
        data_transfer_bytes: 0,
        transfer_charge_multiplier: 10,
        monthly_data_transfer_limit_bytes: 10_000,
        transfer_period_start: '2026-07-01',
        ...overrides
    }
}

describe('local workspace usage history', () => {
    beforeEach(() => {
        appSettingsMock.reset()
    })

    it('stores actual transfer and charged usage separately and computes both insight sets', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 100, data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 150, data_transfer_bytes: 1_500 }),
            new Date('2026-07-02T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            usageStatus({ actual_data_transfer_bytes: 150, data_transfer_bytes: 1_500 }),
            history,
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(history?.dailySnapshots).toEqual([
            { date: '2026-07-01', actualTransferBytes: 100, chargedUsageBytes: 1_000 },
            { date: '2026-07-02', actualTransferBytes: 150, chargedUsageBytes: 1_500 }
        ])
        expect(history?.latestActualTransferBytes).toBe(150)
        expect(history?.latestChargedUsageBytes).toBe(1_500)
        expect(insights.chartData).toEqual([
            {
                date: '2026-07-01',
                actualTransferBytes: 100,
                chargedUsageBytes: 1_000,
                cumulativeActualTransferBytes: 100,
                cumulativeChargedUsageBytes: 1_000
            },
            {
                date: '2026-07-02',
                actualTransferBytes: 50,
                chargedUsageBytes: 500,
                cumulativeActualTransferBytes: 150,
                cumulativeChargedUsageBytes: 1_500
            }
        ])
        expect(insights.averageDailyChargedUsageBytes).toBe(750)
        expect(insights.projectedChargedUsageBytes).toBe(23_250)
        expect(insights.remainingChargedUsageBytes).toBe(8_500)
        expect(insights.dailyChargedUsageBudgetBytes).toBeCloseTo(8_500 / 29)
        expect(insights.peakDailyChargedUsageBytes).toBe(1_000)
        expect(insights.observedChargedUsageBytes).toBe(1_500)
        expect(insights.averageDailyActualTransferBytes).toBe(75)
        expect(insights.projectedActualTransferBytes).toBe(2_325)
        expect(insights.peakDailyActualTransferBytes).toBe(100)
        expect(insights.observedActualTransferBytes).toBe(150)
    })

    it('deletes the ambiguous v1 history instead of reinterpreting it', async () => {
        appSettingsMock.rows.set(workspaceUsageHistoryInternals.legacyStorageKey, JSON.stringify({
            version: 1,
            transferPeriodStart: '2026-07-01',
            workspaces: {
                [workspaceId]: {
                    workspaceId,
                    transferPeriodStart: '2026-07-01',
                    latestTransferBytes: 9_999
                }
            }
        }))

        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 30, data_transfer_bytes: 300 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const stored = JSON.parse(String(appSettingsMock.rows.get(workspaceUsageHistoryInternals.storageKey)))

        expect(appSettingsMock.table.delete).toHaveBeenCalledWith(workspaceUsageHistoryInternals.legacyStorageKey)
        expect(appSettingsMock.rows.has(workspaceUsageHistoryInternals.legacyStorageKey)).toBe(false)
        expect(stored.version).toBe(2)
        expect(history?.dailySnapshots).toEqual([
            { date: '2026-07-01', actualTransferBytes: 30, chargedUsageBytes: 300 }
        ])
    })

    it('deletes every old workspace detail when the transfer period changes', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({
                transfer_period_start: '2026-06-01',
                actual_data_transfer_bytes: 80,
                data_transfer_bytes: 800
            }),
            new Date('2026-06-20T12:00:00.000Z')
        )
        await saveWorkspaceUsageSnapshot(
            usageStatus({
                workspace_id: secondWorkspaceId,
                transfer_period_start: '2026-06-01',
                actual_data_transfer_bytes: 40,
                data_transfer_bytes: 400
            }),
            new Date('2026-06-20T12:05:00.000Z')
        )

        const julyHistory = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 5, data_transfer_bytes: 50 }),
            new Date('2026-07-01T01:00:00.000Z')
        )
        const stored = JSON.parse(String(appSettingsMock.rows.get(workspaceUsageHistoryInternals.storageKey)))

        expect(appSettingsMock.table.delete).toHaveBeenCalledWith(workspaceUsageHistoryInternals.storageKey)
        expect(stored.transferPeriodStart).toBe('2026-07-01')
        expect(Object.keys(stored.workspaces)).toEqual([workspaceId])
        expect(julyHistory?.dailySnapshots).toEqual([
            { date: '2026-07-01', actualTransferBytes: 5, chargedUsageBytes: 50 }
        ])
    })

    it('drops stale snapshots when either server counter is reset in the same period', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 100, data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 125, data_transfer_bytes: 1_250 }),
            new Date('2026-07-02T12:00:00.000Z')
        )
        const resetHistory = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 10, data_transfer_bytes: 100 }),
            new Date('2026-07-03T12:00:00.000Z')
        )

        expect(resetHistory?.dailySnapshots).toEqual([
            { date: '2026-07-03', actualTransferBytes: 10, chargedUsageBytes: 100 }
        ])
        expect(resetHistory?.latestActualTransferBytes).toBe(10)
        expect(resetHistory?.latestChargedUsageBytes).toBe(100)
        expect(resetHistory?.trackedFrom).toBe('2026-07-03T12:00:00.000Z')
    })

    it('keeps one baseline snapshot plus the current-period portion of the 30-day chart', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 10, data_transfer_bytes: 100 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 50, data_transfer_bytes: 500 }),
            new Date('2026-07-31T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            usageStatus({ actual_data_transfer_bytes: 50, data_transfer_bytes: 500 }),
            history,
            new Date('2026-07-31T12:00:00.000Z')
        )

        expect(history?.dailySnapshots).toEqual([
            { date: '2026-07-01', actualTransferBytes: 10, chargedUsageBytes: 100 },
            { date: '2026-07-31', actualTransferBytes: 50, chargedUsageBytes: 500 }
        ])
        expect(insights.chartData).toHaveLength(30)
        expect(insights.chartData[0]?.date).toBe('2026-07-02')
        expect(insights.chartData.at(-1)).toMatchObject({
            date: '2026-07-31',
            actualTransferBytes: 40,
            chargedUsageBytes: 400
        })
    })

    it('treats the first mid-period cumulative sample as a baseline, not a daily spike', async () => {
        const status = usageStatus({
            actual_data_transfer_bytes: 250,
            data_transfer_bytes: 2_500
        })
        const history = await saveWorkspaceUsageSnapshot(
            status,
            new Date('2026-07-15T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            status,
            history,
            new Date('2026-07-15T12:00:00.000Z')
        )

        expect(insights.chartData.at(-1)).toMatchObject({
            date: '2026-07-15',
            actualTransferBytes: 0,
            chargedUsageBytes: 0
        })
        expect(insights.peakDailyActualTransferBytes).toBe(0)
        expect(insights.peakDailyChargedUsageBytes).toBe(0)
    })

    it('removes local details when workspace usage limits are disabled', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 100, data_transfer_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )

        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({
                has_limits: false,
                actual_data_transfer_bytes: 100,
                data_transfer_bytes: 1_000
            }),
            new Date('2026-07-01T12:01:00.000Z')
        )

        expect(history).toBeNull()
        expect(appSettingsMock.rows.has(workspaceUsageHistoryInternals.storageKey)).toBe(false)
    })

    it('deletes corrupt or ambiguous v2 data before saving a clean sample', async () => {
        appSettingsMock.rows.set(workspaceUsageHistoryInternals.storageKey, JSON.stringify({
            version: 2,
            transferPeriodStart: '2026-07-01',
            workspaces: {
                [workspaceId]: {
                    workspaceId,
                    transferPeriodStart: '2026-07-01',
                    trackedFrom: '2026-07-01T10:00:00.000Z',
                    lastSampleAt: '2026-07-01T10:00:00.000Z',
                    latestTransferBytes: 999,
                    dailySnapshots: [{ date: '2026-07-01', transferBytes: 999 }]
                }
            }
        }))

        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ actual_data_transfer_bytes: 30, data_transfer_bytes: 300 }),
            new Date('2026-07-01T12:00:00.000Z')
        )

        expect(appSettingsMock.table.delete).toHaveBeenCalledWith(workspaceUsageHistoryInternals.storageKey)
        expect(history?.latestActualTransferBytes).toBe(30)
        expect(history?.latestChargedUsageBytes).toBe(300)
    })

    it('keeps charged quota fields null for unlimited transfer while retaining actual insights', () => {
        const insights = buildWorkspaceUsageInsights(
            usageStatus({
                actual_data_transfer_bytes: 200,
                data_transfer_bytes: 2_000,
                monthly_data_transfer_limit_bytes: null
            }),
            null,
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(insights.remainingChargedUsageBytes).toBeNull()
        expect(insights.dailyChargedUsageBudgetBytes).toBeNull()
        expect(insights.averageDailyActualTransferBytes).toBe(100)
        expect(insights.projectedActualTransferBytes).toBe(3_100)
        // Without a previous local snapshot, the cumulative counters are a
        // baseline rather than invented same-day consumption.
        expect(insights.observedActualTransferBytes).toBe(0)
        expect(insights.observedChargedUsageBytes).toBe(0)
    })
})
