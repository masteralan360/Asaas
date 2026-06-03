import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
    const rows: Array<Record<string, any>> = []

    const offlineMutations = {
        where: vi.fn((indexName: string) => ({
            equals: vi.fn((value: unknown) => ({
                sortBy: vi.fn(async (sortField: string) => {
                    if (indexName !== 'status' || sortField !== 'createdAt') {
                        throw new Error(`Unsupported query: ${indexName}/${sortField}`)
                    }

                    return rows
                        .filter((row) => row.status === value)
                        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
                })
            }))
        })),
        update: vi.fn(async (id: string, patch: Record<string, any>) => {
            const row = rows.find((item) => item.id === id)
            if (!row) return 0

            Object.assign(row, patch)
            return 1
        })
    }

    return {
        rows,
        offlineMutations,
        reset() {
            rows.splice(0)
            offlineMutations.where.mockClear()
            offlineMutations.update.mockClear()
        }
    }
})

const supabaseMock = vi.hoisted(() => {
    const mutationError = new Error('permission denied')
    const upsert = vi.fn(async () => ({ data: null, error: mutationError }))
    const rpc = vi.fn(async () => ({ data: null, error: null }))

    const makeBuilder = (tableName: string) => {
        const builder: Record<string, any> = {}
        Object.assign(builder, {
            select: vi.fn(() => builder),
            eq: vi.fn((column: string) => {
                if (tableName === 'workspaces' && column === 'id') {
                    return Promise.resolve({ data: [], error: null })
                }

                return builder
            }),
            gt: vi.fn(() => builder),
            order: vi.fn(() => builder),
            range: vi.fn(async () => ({ data: [], error: null })),
            in: vi.fn(() => builder),
            upsert,
            update: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: null, error: null }))
            })),
            delete: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: null, error: null }))
            }))
        })

        return builder
    }

    const from = vi.fn((tableName: string) => makeBuilder(tableName))

    return {
        client: { from },
        from,
        mutationError,
        rpc,
        upsert,
        reset() {
            from.mockClear()
            rpc.mockClear()
            upsert.mockClear()
        }
    }
})

const workspaceModeMock = vi.hoisted(() => ({
    isLocalWorkspaceMode: vi.fn(() => false)
}))

vi.mock('@/auth/supabase', () => ({
    isSupabaseConfigured: true,
    supabase: {
        from: supabaseMock.from,
        rpc: supabaseMock.rpc
    }
}))

vi.mock('@/local-db', () => ({
    db: {
        offline_mutations: dbMock.offlineMutations
    }
}))

vi.mock('@/local-db/inventory', () => ({
    syncProductStockSnapshot: vi.fn(async () => undefined)
}))

vi.mock('@/local-db/productBarcodes', () => ({
    syncProductBarcodeCachesForWorkspace: vi.fn(async () => undefined)
}))

vi.mock('@/lib/supabaseRequest', () => ({
    runSupabaseAction: vi.fn((_label: string, action: () => PromiseLike<unknown>) => action())
}))

vi.mock('@/lib/supabaseSchema', () => ({
    getSupabaseClientForTable: vi.fn(() => supabaseMock.client)
}))

vi.mock('@/workspace/workspaceMode', () => ({
    isLocalWorkspaceMode: workspaceModeMock.isLocalWorkspaceMode
}))

import { fullSync } from './syncEngine'

describe('fullSync error reporting', () => {
    beforeEach(() => {
        dbMock.reset()
        supabaseMock.reset()
        workspaceModeMock.isLocalWorkspaceMode.mockReset()
        workspaceModeMock.isLocalWorkspaceMode.mockReturnValue(false)
    })

    it('returns a failed result with the mutation error and leaves the queued mutation marked failed', async () => {
        dbMock.rows.push({
            id: 'mutation-1',
            workspaceId: 'workspace-1',
            entityType: 'products',
            entityId: 'product-1',
            operation: 'update',
            payload: {
                id: 'product-1',
                name: 'Desk',
                syncStatus: 'pending',
                lastSyncedAt: null,
                updatedAt: '2026-06-03T00:00:00.000Z'
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'pending'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result).toEqual({
            success: false,
            pushed: 0,
            pulled: 0,
            errors: ['permission denied']
        })
        expect(dbMock.rows[0]).toMatchObject({
            status: 'failed',
            error: 'permission denied'
        })
        expect(dbMock.offlineMutations.update).toHaveBeenCalledWith('mutation-1', { status: 'syncing' })
        expect(dbMock.offlineMutations.update).toHaveBeenLastCalledWith('mutation-1', {
            status: 'failed',
            error: 'permission denied'
        })

        expect(supabaseMock.upsert).toHaveBeenCalledTimes(1)
        const firstUpsertCall = supabaseMock.upsert.mock.calls[0] as unknown as [Record<string, unknown>]
        const payload = firstUpsertCall[0]
        expect(payload).toMatchObject({
            id: 'product-1',
            name: 'Desk',
            workspace_id: 'workspace-1',
            updated_at: '2026-06-03T00:00:00.000Z'
        })
        expect(payload).not.toHaveProperty('sync_status')
        expect(payload).not.toHaveProperty('last_synced_at')
    })
})
