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

vi.mock('@/local-db/database', () => ({ db: { app_settings: appSettingsMock.table } }))

import {
    buildWorkspaceUsageInsights,
    saveWorkspaceUsageSnapshot,
    workspaceUsageHistoryInternals
} from './workspaceUsageHistory'

const workspaceId = '2f3c9c52-1d56-42d0-9643-a381f14bac6d'

function usageStatus(overrides: Partial<WorkspaceUsageStatus> = {}): WorkspaceUsageStatus {
    return {
        workspace_id: workspaceId,
        has_limits: true,
        storage_units: 25,
        storage_unit_limit: 100,
        charged_usage_bytes: 0,
        monthly_data_transfer_limit_bytes: 10_000,
        transfer_period_start: '2026-07-01',
        ...overrides
    }
}

describe('local charged workspace usage history', () => {
    beforeEach(() => appSettingsMock.reset())

    it('stores only charged cumulative snapshots', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 1_500 }),
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(history?.dailySnapshots).toEqual([
            { date: '2026-07-01', chargedUsageBytes: 1_000 },
            { date: '2026-07-02', chargedUsageBytes: 1_500 }
        ])
        expect(history?.latestChargedUsageBytes).toBe(1_500)
        const persisted = JSON.parse(appSettingsMock.rows.get(workspaceUsageHistoryInternals.storageKey) ?? '{}')
        expect(persisted.version).toBe(3)
        expect(JSON.stringify(persisted)).not.toContain('actual')
    })

    it('derives daily charged consumption from cumulative snapshots', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const history = await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 1_500 }),
            new Date('2026-07-02T12:00:00.000Z')
        )
        const insights = buildWorkspaceUsageInsights(
            usageStatus({ charged_usage_bytes: 1_500 }),
            history,
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(insights.chartData.slice(0, 2)).toEqual([
            { date: '2026-07-01', chargedUsageBytes: 1_000, cumulativeChargedUsageBytes: 1_000 },
            { date: '2026-07-02', chargedUsageBytes: 500, cumulativeChargedUsageBytes: 1_500 }
        ])
        expect(insights.remainingChargedUsageBytes).toBe(8_500)
    })

    it('treats the first mid-period sample as a baseline instead of a spike', async () => {
        const status = usageStatus({ charged_usage_bytes: 2_500 })
        const history = await saveWorkspaceUsageSnapshot(status, new Date('2026-07-15T12:00:00.000Z'))
        const insights = buildWorkspaceUsageInsights(status, history, new Date('2026-07-15T12:00:00.000Z'))

        expect(insights.chartData.at(-1)).toMatchObject({
            date: '2026-07-15',
            chargedUsageBytes: 0,
            cumulativeChargedUsageBytes: 2_500
        })
    })

    it('starts a new local baseline when the single charged counter resets', async () => {
        await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 1_000 }),
            new Date('2026-07-01T12:00:00.000Z')
        )
        const resetHistory = await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 100 }),
            new Date('2026-07-02T12:00:00.000Z')
        )

        expect(resetHistory?.dailySnapshots).toEqual([
            { date: '2026-07-02', chargedUsageBytes: 100 }
        ])
        expect(resetHistory?.trackedFrom).toBe('2026-07-02T12:00:00.000Z')
    })

    it('removes prior formats instead of retaining obsolete raw-byte data', async () => {
        appSettingsMock.rows.set('workspace_usage_history:v1', '{"actual":123}')
        appSettingsMock.rows.set('workspace_usage_history:v2', '{"actual":456}')

        await saveWorkspaceUsageSnapshot(
            usageStatus({ charged_usage_bytes: 100 }),
            new Date('2026-07-01T12:00:00.000Z')
        )

        expect(appSettingsMock.rows.has('workspace_usage_history:v1')).toBe(false)
        expect(appSettingsMock.rows.has('workspace_usage_history:v2')).toBe(false)
    })
})
