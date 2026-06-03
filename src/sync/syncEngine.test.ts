import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
    const rows: Array<Record<string, any>> = []
    const sales = {
        update: vi.fn(async () => 1)
    }
    const invoices = {
        update: vi.fn(async () => 1)
    }

    const offlineMutations = {
        where: vi.fn((indexName: string) => ({
            equals: vi.fn((value: unknown) => {
                const matchingRows = () => rows.filter((row) => row.status === value)
                const sortRows = async (sourceRows: Array<Record<string, any>>, sortField: string) => {
                    if (indexName !== 'status' || sortField !== 'createdAt') {
                        throw new Error(`Unsupported query: ${indexName}/${sortField}`)
                    }

                    return sourceRows.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
                }
                return {
                    sortBy: vi.fn((sortField: string) => sortRows(matchingRows(), sortField)),
                    filter: vi.fn((predicate: (row: Record<string, any>) => boolean) => ({
                        sortBy: vi.fn((sortField: string) => sortRows(matchingRows().filter(predicate), sortField)),
                        count: vi.fn(async () => matchingRows().filter(predicate).length)
                    })),
                    count: vi.fn(async () => matchingRows().length)
                }
            })
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
        sales,
        invoices,
        reset() {
            rows.splice(0)
            offlineMutations.where.mockClear()
            offlineMutations.update.mockClear()
            sales.update.mockClear()
            invoices.update.mockClear()
        }
    }
})

const supabaseMock = vi.hoisted(() => {
    const mutationError = new Error('permission denied')
    const upsert = vi.fn(async () => ({ data: null, error: mutationError }))
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    let saleLookup: Record<string, any> | null = null

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
            maybeSingle: vi.fn(async () => ({ data: tableName === 'sales' ? saleLookup : null, error: null })),
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
        setSaleLookup(row: Record<string, any> | null) {
            saleLookup = row
        },
        reset() {
            from.mockClear()
            rpc.mockClear()
            upsert.mockClear()
            saleLookup = null
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
        offline_mutations: dbMock.offlineMutations,
        sales: dbMock.sales,
        invoices: dbMock.invoices
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

    it('replaces the temporary offline sale id display with the server sequence id', async () => {
        supabaseMock.rpc.mockResolvedValueOnce({
            data: {
                sequence_id: 7,
                system_verified: true,
                system_review_status: 'approved',
                system_review_reason: null
            },
            error: null
        })
        dbMock.rows.push({
            id: 'mutation-2',
            workspaceId: 'workspace-1',
            entityType: 'sales',
            entityId: '65cd27b9-0000-4000-8000-000000000000',
            operation: 'create',
            payload: {
                id: '65cd27b9-0000-4000-8000-000000000000',
                total_amount: 1000,
                settlement_currency: 'iqd',
                items: []
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'pending'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(true)
        expect(supabaseMock.rpc).toHaveBeenCalledWith('complete_sale', {
            payload: expect.objectContaining({
                id: '65cd27b9-0000-4000-8000-000000000000',
                settlement_currency: 'iqd'
            })
        })
        expect(dbMock.sales.update).toHaveBeenCalledWith(
            '65cd27b9-0000-4000-8000-000000000000',
            expect.objectContaining({
                sequenceId: 7,
                syncStatus: 'synced',
                systemVerified: true,
                systemReviewStatus: 'approved'
            })
        )
        expect(dbMock.invoices.update).toHaveBeenCalledWith(
            '65cd27b9-0000-4000-8000-000000000000',
            expect.objectContaining({
                sequenceId: 7,
                invoiceid: '#00007',
                syncStatus: 'synced'
            })
        )
        expect(dbMock.rows[0]).toMatchObject({ status: 'synced' })
    })

    it('recovers an interrupted sale create using the existing server row sequence id', async () => {
        supabaseMock.rpc.mockResolvedValueOnce({
            data: null,
            error: Object.assign(new Error('duplicate key value'), { code: '23505' })
        })
        supabaseMock.setSaleLookup({
            id: '65cd27b9-0000-4000-8000-000000000000',
            sequence_id: 8,
            system_verified: true,
            system_review_status: 'approved',
            system_review_reason: null
        })
        dbMock.rows.push({
            id: 'mutation-3',
            workspaceId: 'workspace-1',
            entityType: 'sales',
            entityId: '65cd27b9-0000-4000-8000-000000000000',
            operation: 'create',
            payload: {
                id: '65cd27b9-0000-4000-8000-000000000000',
                total_amount: 1000,
                settlement_currency: 'iqd',
                items: []
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'syncing'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(true)
        expect(dbMock.sales.update).toHaveBeenCalledWith(
            '65cd27b9-0000-4000-8000-000000000000',
            expect.objectContaining({
                sequenceId: 8,
                syncStatus: 'synced'
            })
        )
        expect(dbMock.rows[0]).toMatchObject({ status: 'synced', error: undefined })
    })

    it('retries a failed offline sale create instead of leaving the temporary id forever', async () => {
        supabaseMock.rpc.mockResolvedValueOnce({
            data: { sequence_id: 9 },
            error: null
        })
        dbMock.rows.push({
            id: 'mutation-4',
            workspaceId: 'workspace-1',
            entityType: 'sales',
            entityId: '65cd27b9-0000-4000-8000-000000000000',
            operation: 'create',
            payload: {
                id: '65cd27b9-0000-4000-8000-000000000000',
                total_amount: 1000,
                settlement_currency: 'iqd',
                items: []
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'failed',
            error: 'network timeout'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(true)
        expect(dbMock.sales.update).toHaveBeenCalledWith(
            '65cd27b9-0000-4000-8000-000000000000',
            expect.objectContaining({
                sequenceId: 9,
                syncStatus: 'synced'
            })
        )
        expect(dbMock.rows[0]).toMatchObject({ status: 'synced', error: undefined })
    })
})
