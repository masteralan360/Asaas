import { generateId } from '@/lib/utils'
import { isSchemaMismatchError, isSyncIntegrityError } from '@/sync/syncErrors'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { db } from './database'
import type { OfflineMutation } from './models'

const LOCAL_ONLY_ENTITY_TYPES = new Set<OfflineMutation['entityType']>([
    'inventory_transfer_transactions'
])

function isCloudInventoryTransactionMutation(
    entityType: OfflineMutation['entityType'],
    payload: Record<string, unknown>
) {
    if (entityType !== 'inventory_transactions') {
        return true
    }

    const transactionType = payload.transactionType || payload.transaction_type
    return transactionType === 'stock_adjustment'
}

export async function addToOfflineMutations(
    entityType: OfflineMutation['entityType'],
    entityId: string,
    operation: OfflineMutation['operation'],
    payload: Record<string, unknown>,
    workspaceId: string
): Promise<void> {
    if (
        isLocalWorkspaceMode(workspaceId)
        || LOCAL_ONLY_ENTITY_TYPES.has(entityType)
        || !isCloudInventoryTransactionMutation(entityType, payload)
    ) {
        return
    }

    const existing = await db.offline_mutations
        .where('[entityType+entityId+status]')
        .equals([entityType, entityId, 'pending'])
        .first()

    if (existing) {
        if (operation === 'delete') {
            if (existing.operation === 'create') {
                await db.offline_mutations.delete(existing.id)
                return
            }

            await db.offline_mutations.update(existing.id, {
                operation: 'delete',
                payload: { ...payload, id: entityId },
                createdAt: new Date().toISOString()
            })
            return
        }

        if (operation === 'update' || operation === 'create') {
            await db.offline_mutations.update(existing.id, {
                operation: existing.operation === 'delete' ? 'update' : existing.operation,
                payload: { ...existing.payload, ...payload },
                createdAt: new Date().toISOString()
            })
            return
        }
    }

    await db.offline_mutations.add({
        id: generateId(),
        workspaceId,
        entityType,
        entityId,
        operation,
        payload,
        createdAt: new Date().toISOString(),
        status: 'pending'
    })
}

/**
 * Schema mismatches are intentionally excluded from automatic retries. A user
 * can explicitly retry them after the database migration has been deployed.
 */
export async function retrySchemaMismatchMutations(workspaceId: string): Promise<number> {
    const rows = await db.offline_mutations
        .where('status')
        .equals('failed')
        .filter((mutation) => mutation.workspaceId === workspaceId && isSchemaMismatchError(mutation.error))
        .toArray()

    if (rows.length === 0) return 0

    await db.offline_mutations.bulkUpdate(rows.map((mutation) => ({
        key: mutation.id,
        changes: {
            status: 'pending' as const,
            error: undefined
        }
    })))

    return rows.length
}

/**
 * Requeue deterministic server rejections only after a user explicitly asks
 * to retry. They must never be picked up by background retry loops.
 */
export async function retrySyncIntegrityMutations(workspaceId: string): Promise<number> {
    const rows = await db.offline_mutations
        .where('status')
        .equals('failed')
        .filter((mutation) => mutation.workspaceId === workspaceId && isSyncIntegrityError(mutation.error))
        .toArray()

    if (rows.length === 0) return 0

    await db.offline_mutations.bulkUpdate(rows.map((mutation) => ({
        key: mutation.id,
        changes: {
            status: 'pending' as const,
            error: undefined
        }
    })))

    return rows.length
}
