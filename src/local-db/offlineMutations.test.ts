import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutationStore = vi.hoisted(() => {
    const rows: Array<Record<string, any>> = []

    const table = {
        where: vi.fn((indexName: string) => ({
            equals: vi.fn((key: unknown) => ({
                first: vi.fn(async () => {
                    if (indexName !== '[entityType+entityId+status]') {
                        throw new Error(`Unsupported index: ${indexName}`)
                    }

                    const [entityType, entityId, status] = key as [string, string, string]
                    return rows.find((row) =>
                        row.entityType === entityType
                        && row.entityId === entityId
                        && row.status === status
                    )
                })
            }))
        })),
        add: vi.fn(async (row: Record<string, any>) => {
            rows.push({ ...row })
            return row.id
        }),
        update: vi.fn(async (id: string, patch: Record<string, any>) => {
            const row = rows.find((item) => item.id === id)
            if (!row) return 0

            Object.assign(row, patch)
            return 1
        }),
        delete: vi.fn(async (id: string) => {
            const index = rows.findIndex((row) => row.id === id)
            if (index === -1) return 0

            rows.splice(index, 1)
            return 1
        })
    }

    return {
        rows,
        table,
        reset() {
            rows.splice(0)
            table.where.mockClear()
            table.add.mockClear()
            table.update.mockClear()
            table.delete.mockClear()
        }
    }
})

const idMock = vi.hoisted(() => {
    let nextId = 0
    const generateId = vi.fn(() => `offline-mutation-${++nextId}`)

    return {
        generateId,
        reset() {
            nextId = 0
            generateId.mockClear()
        }
    }
})

const workspaceModeMock = vi.hoisted(() => ({
    isLocalWorkspaceMode: vi.fn(() => false)
}))

vi.mock('./database', () => ({
    db: {
        offline_mutations: mutationStore.table
    }
}))

vi.mock('@/lib/utils', () => ({
    generateId: idMock.generateId
}))

vi.mock('@/workspace/workspaceMode', () => ({
    isLocalWorkspaceMode: workspaceModeMock.isLocalWorkspaceMode
}))

import { addToOfflineMutations } from './offlineMutations'

describe('addToOfflineMutations', () => {
    beforeEach(() => {
        mutationStore.reset()
        idMock.reset()
        workspaceModeMock.isLocalWorkspaceMode.mockReset()
        workspaceModeMock.isLocalWorkspaceMode.mockReturnValue(false)
    })

    it('merges repeated pending updates for the same entity', async () => {
        await addToOfflineMutations(
            'products',
            'product-1',
            'update',
            { name: 'Original', quantity: 1 },
            'workspace-1'
        )

        await addToOfflineMutations(
            'products',
            'product-1',
            'update',
            { quantity: 2, price: 100 },
            'workspace-1'
        )

        expect(mutationStore.rows).toHaveLength(1)
        expect(mutationStore.rows[0]).toMatchObject({
            operation: 'update',
            payload: {
                name: 'Original',
                quantity: 2,
                price: 100
            },
            status: 'pending'
        })
        expect(mutationStore.table.add).toHaveBeenCalledTimes(1)
        expect(mutationStore.table.update).toHaveBeenCalledTimes(1)
    })

    it('keeps an offline create as create when later fields are updated', async () => {
        await addToOfflineMutations(
            'customers',
            'customer-1',
            'create',
            { name: 'Draft customer' },
            'workspace-1'
        )

        await addToOfflineMutations(
            'customers',
            'customer-1',
            'update',
            { phone: '555-0100' },
            'workspace-1'
        )

        expect(mutationStore.rows).toHaveLength(1)
        expect(mutationStore.rows[0]).toMatchObject({
            operation: 'create',
            payload: {
                name: 'Draft customer',
                phone: '555-0100'
            }
        })
    })

    it('drops an offline create when the entity is deleted before sync', async () => {
        await addToOfflineMutations(
            'categories',
            'category-1',
            'create',
            { name: 'Temporary' },
            'workspace-1'
        )

        await addToOfflineMutations(
            'categories',
            'category-1',
            'delete',
            {},
            'workspace-1'
        )

        expect(mutationStore.rows).toHaveLength(0)
        expect(mutationStore.table.delete).toHaveBeenCalledWith('offline-mutation-1')
    })

    it('coalesces a pending update into a delete mutation with entity id in the payload', async () => {
        await addToOfflineMutations(
            'suppliers',
            'supplier-1',
            'update',
            { name: 'Supplier A' },
            'workspace-1'
        )

        await addToOfflineMutations(
            'suppliers',
            'supplier-1',
            'delete',
            { deletedBy: 'user-1' },
            'workspace-1'
        )

        expect(mutationStore.rows).toHaveLength(1)
        expect(mutationStore.rows[0]).toMatchObject({
            operation: 'delete',
            payload: {
                deletedBy: 'user-1',
                id: 'supplier-1'
            }
        })
        expect(mutationStore.table.update).toHaveBeenCalledTimes(1)
    })

    it('does not queue mutations for local-only workspaces', async () => {
        workspaceModeMock.isLocalWorkspaceMode.mockReturnValue(true)

        await addToOfflineMutations(
            'products',
            'product-1',
            'update',
            { name: 'Local product' },
            'local-workspace-1'
        )

        expect(mutationStore.rows).toHaveLength(0)
        expect(mutationStore.table.add).not.toHaveBeenCalled()
    })
})
