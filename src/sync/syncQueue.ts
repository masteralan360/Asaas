import { db } from '@/local-db/database'
import type { SyncQueueItem } from '@/local-db/models'
import { generateId } from '@/lib/utils'

// Add item to sync queue
export async function addToQueue(
    entityType: SyncQueueItem['entityType'],
    entityId: string,
    operation: SyncQueueItem['operation'],
    data: Record<string, unknown>
): Promise<void> {
    const existing = await db.syncQueue
        .where('entityId')
        .equals(entityId)
        .first()

    if (existing) {
        // If create followed by update, keep as create
        // If create followed by delete, remove from queue entirely
        if (existing.operation === 'create' && operation === 'delete') {
            await db.syncQueue.delete(existing.id)
            return
        }

        await db.syncQueue.update(existing.id, {
            operation: existing.operation === 'create' ? 'create' : operation,
            data,
            timestamp: new Date().toISOString()
        })
    } else {
        await db.syncQueue.add({
            id: generateId(),
            entityType,
            entityId,
            operation,
            data,
            timestamp: new Date().toISOString(),
            retryCount: 0
        })
    }
}

// Get all pending items
export async function getPendingItems(): Promise<SyncQueueItem[]> {
    return await db.syncQueue.orderBy('timestamp').toArray()
}

// Get pending count
export async function getPendingCount(): Promise<number> {
    return await db.syncQueue.count()
}

// Remove item from queue
export async function removeFromQueue(id: string): Promise<void> {
    await db.syncQueue.delete(id)
}

// Increment retry count
export async function incrementRetry(id: string): Promise<void> {
    const item = await db.syncQueue.get(id)
    if (item) {
        await db.syncQueue.update(id, {
            retryCount: item.retryCount + 1
        })
    }
}

// Clear entire queue
export async function clearQueue(): Promise<void> {
    await db.syncQueue.clear()
}

// Get items by entity type
export async function getQueueByEntityType(
    entityType: SyncQueueItem['entityType']
): Promise<SyncQueueItem[]> {
    return await db.syncQueue
        .where('entityType')
        .equals(entityType)
        .toArray()
}
