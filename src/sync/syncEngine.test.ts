import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
    const rows: Array<Record<string, any>> = []
    const sales = {
        update: vi.fn(async () => 1)
    }
    const invoices = {
        update: vi.fn(async () => 1)
    }
    const saleReturns = {
        update: vi.fn(async () => 1)
    }
    const saleReturnItems = {
        where: vi.fn(() => ({
            equals: vi.fn(() => ({
                modify: vi.fn(async () => 1)
            }))
        }))
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
        saleReturns,
        saleReturnItems,
        reset() {
            rows.splice(0)
            offlineMutations.where.mockClear()
            offlineMutations.update.mockClear()
            sales.update.mockClear()
            invoices.update.mockClear()
            saleReturns.update.mockClear()
            saleReturnItems.where.mockClear()
        }
    }
})

const supabaseMock = vi.hoisted(() => {
    const mutationError = new Error('permission denied')
    const upsert = vi.fn(async (): Promise<{ data: null; error: Error | null }> => ({ data: null, error: mutationError }))
    const rpc = vi.fn(async () => ({ data: null as any, error: null as any }))
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
        invoices: dbMock.invoices,
        sale_returns: dbMock.saleReturns,
        sale_return_items: dbMock.saleReturnItems
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

import { fullSync, isRecoverablePriceBookMutation, shouldApplyRemoteItem } from './syncEngine'

describe('Price Book sync recovery', () => {
    it('recognizes entitlement, dependency, network, and unique-name failures as recoverable', () => {
        for (const error of [
            'permission denied by row-level security (42501)',
            'fetch failed: network timeout',
            'duplicate key violates unique constraint (23505)',
            'Price book item must reference a price book in the same workspace (23514)'
        ]) {
            expect(isRecoverablePriceBookMutation({ entityType: 'price_book_items', error })).toBe(true)
        }
        expect(isRecoverablePriceBookMutation({ entityType: 'products', error: 'permission denied' })).toBe(false)
    })

    it('applies the newer timestamp when concurrent rows have the same version', () => {
        const local = {
            version: 2,
            updatedAt: '2026-07-12T08:00:00.000Z',
            syncStatus: 'synced'
        }
        expect(shouldApplyRemoteItem('price_book_items', local, {
            version: 2,
            updatedAt: '2026-07-12T09:00:00.000Z'
        })).toBe(true)
        expect(shouldApplyRemoteItem('price_book_items', local, {
            version: 2,
            updatedAt: '2026-07-12T07:00:00.000Z'
        })).toBe(false)
    })
})

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

    it('leaves dependent Price Book items pending when their parent book fails', async () => {
        dbMock.rows.push({
            id: 'price-book-mutation',
            workspaceId: 'workspace-1',
            entityType: 'price_books',
            entityId: 'price-book-1',
            operation: 'create',
            payload: { id: 'price-book-1', name: 'Wholesale' },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'pending'
        }, {
            id: 'price-book-item-mutation',
            workspaceId: 'workspace-1',
            entityType: 'price_book_items',
            entityId: 'price-book-item-1',
            operation: 'create',
            payload: {
                id: 'price-book-item-1',
                priceBookId: 'price-book-1',
                productId: 'product-1',
                costPrice: 10,
                price: 12,
                currency: 'usd'
            },
            createdAt: '2026-06-03T00:00:01.000Z',
            status: 'pending'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(false)
        expect(supabaseMock.upsert).toHaveBeenCalledTimes(1)
        expect(dbMock.rows[0]).toMatchObject({ status: 'failed', error: 'permission denied' })
        expect(dbMock.rows[1]).toMatchObject({ status: 'pending' })
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
                sales_exchange: [{
                    base_currency: 'usd',
                    quote_currency: 'iqd',
                    base_amount: 100,
                    quote_amount: 145000,
                    source: 'manual',
                    captured_at: '2026-06-03T00:00:00.000Z',
                    rate_side: 'mid',
                    source_price_id: null,
                    source_price_updated_at: null
                }],
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
                settlement_currency: 'iqd',
                sales_exchange: expect.arrayContaining([
                    expect.objectContaining({
                        base_currency: 'usd',
                        quote_currency: 'iqd',
                        base_amount: 100,
                        quote_amount: 145000
                    })
                ])
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

    it('preserves an invoice order link when pushing an offline mutation', async () => {
        supabaseMock.upsert.mockResolvedValueOnce({ data: null, error: null })
        dbMock.rows.push({
            id: 'mutation-invoice-1',
            workspaceId: 'workspace-1',
            entityType: 'invoices',
            entityId: '65cd27b9-0000-4000-8000-000000000001',
            operation: 'create',
            payload: {
                id: '65cd27b9-0000-4000-8000-000000000001',
                workspaceId: 'workspace-1',
                invoiceid: '#00008',
                orderId: '65cd27b9-0000-4000-8000-000000000002',
                totalAmount: 1000,
                settlementCurrency: 'iqd',
                pdfBlobA4: new Blob(['pdf']),
                syncStatus: 'pending',
                lastSyncedAt: null
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'pending'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(true)
        expect(supabaseMock.upsert).toHaveBeenCalledWith(expect.objectContaining({
            id: '65cd27b9-0000-4000-8000-000000000001',
            order_id: '65cd27b9-0000-4000-8000-000000000002'
        }))
        const invoiceUpsertCall = supabaseMock.upsert.mock.calls[0] as unknown as [Record<string, unknown>]
        const invoicePayload = invoiceUpsertCall[0]
        expect(invoicePayload).not.toHaveProperty('pdf_blob_a4')
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

    it('retries a network-failed sale return with stable return and line ids', async () => {
        dbMock.rows.push({
            id: 'mutation-return-1',
            workspaceId: 'workspace-1',
            entityType: 'sales',
            entityId: 'sale-1',
            operation: 'update',
            payload: {
                __rpc_action: 'process_sale_return',
                p_return_id: 'return-1',
                p_sale_id: 'sale-1',
                p_items: [{
                    id: 'return-line-1',
                    sale_item_id: 'sale-item-1',
                    quantity: 2
                }],
                p_return_reason: 'Damaged',
                p_refund_method: null
            },
            createdAt: '2026-06-03T00:00:00.000Z',
            status: 'failed',
            error: 'network timeout'
        })

        const result = await fullSync('user-1', 'workspace-1', null)

        expect(result.success).toBe(true)
        expect(supabaseMock.rpc).toHaveBeenCalledWith('process_sale_return', {
            p_return_id: 'return-1',
            p_sale_id: 'sale-1',
            p_items: [{
                id: 'return-line-1',
                sale_item_id: 'sale-item-1',
                quantity: 2
            }],
            p_return_reason: 'Damaged',
            p_refund_method: null
        })
        expect(dbMock.saleReturns.update).toHaveBeenCalledWith(
            'return-1',
            expect.objectContaining({ syncStatus: 'synced' })
        )
        expect(dbMock.rows[0]).toMatchObject({ status: 'synced' })
    })
})
