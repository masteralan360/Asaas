import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { db } from '@/local-db'
import { getPendingItems, removeFromQueue, incrementRetry } from './syncQueue'

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncResult {
    success: boolean
    pushed: number
    pulled: number
    errors: string[]
}

// Convert camelCase to snake_case
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
        result[snakeKey] = obj[key]
    }
    return result
}

// Convert snake_case to camelCase
function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        result[camelKey] = obj[key]
    }
    return result
}

// Get table name for entity type
function getTableName(entityType: string): string {
    return entityType
}

// Timeout helper
async function withTimeout<T>(promise: Promise<T>, ms: number = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            console.warn(`[Sync] Request timed out after ${ms}ms`)
            reject(new Error('Request timed out'))
        }, ms)

        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (err: any) => {
                clearTimeout(timer)
                reject(err)
            }
        ).catch((err: any) => {
            clearTimeout(timer)
            reject(err)
        })
    })
}

// Push a single item to Supabase
async function pushItem(item: any, userId: string, workspaceId: string): Promise<boolean> {
    console.log(`[Sync] START pushItem: ${item.entityType} ${item.operation} (${item.entityId})`)
    const tableName = getTableName(item.entityType)
    const data = toSnakeCase(item.data) as Record<string, unknown>

    // Ensure critical fields are set
    data.user_id = userId
    data.workspace_id = workspaceId

    // Remove local-only metadata that shouldn't be synced to server
    delete data.sync_status
    delete data.last_synced_at

    try {
        switch (item.operation) {
            case 'create':
            case 'update': {
                console.log(`[Sync] Calling Supabase upsert on ${tableName}...`)
                const { error } = (await withTimeout(
                    supabase
                        .from(tableName)
                        .upsert(data, { onConflict: 'id' }) as any,
                    20000
                )) as any

                if (error) {
                    console.error(`[Sync] Supabase UPSERT ERROR for ${item.entityType}:`, error)
                    throw error
                }
                break
            }
            case 'delete': {
                console.log(`[Sync] Calling Supabase update (is_deleted=true) on ${tableName}...`)
                const { error } = (await withTimeout(
                    supabase
                        .from(tableName)
                        .update({ is_deleted: true, updated_at: new Date().toISOString() })
                        .eq('id', item.entityId) as any,
                    20000
                )) as any

                if (error) {
                    console.error(`[Sync] Supabase DELETE ERROR for ${item.entityType}:`, error)
                    throw error
                }
                break
            }
        }
        console.log(`[Sync] SUCCESS pushItem: ${item.entityType} ${item.operation}`)
        return true
    } catch (error: any) {
        console.error(`[Sync] FAILED pushItem: ${item.entityType} ${item.operation}. Error:`, error.message || error)
        return false
    }
}

// Push all pending changes to Supabase
export async function pushChanges(userId: string, workspaceId: string): Promise<{ success: number; failed: number }> {
    if (!isSupabaseConfigured) {
        console.log('[Sync] pushChanges: Supabase not configured')
        return { success: 0, failed: 0 }
    }

    const pendingItems = await getPendingItems()
    console.log(`[Sync] pushChanges: Found ${pendingItems.length} items in queue`)

    let successCount = 0
    let failedCount = 0

    for (const item of pendingItems) {
        if (item.retryCount >= 5) { // Increased retry limit
            console.warn(`[Sync] pushChanges: Skipping item ${item.entityId} after ${item.retryCount} failed attempts`)
            failedCount++
            continue
        }

        const pushed = await pushItem(item, userId, workspaceId)
        if (pushed) {
            await removeFromQueue(item.id)

            // Update local record sync status
            const table = (db as any)[item.entityType]
            if (table) {
                await table.update(item.entityId, {
                    syncStatus: 'synced',
                    lastSyncedAt: new Date().toISOString()
                })
            }

            successCount++
        } else {
            console.log(`[Sync] pushChanges: Incrementing retry for ${item.entityId}`)
            await incrementRetry(item.id)
            failedCount++
        }
    }

    console.log(`[Sync] pushChanges COMPLETE: ${successCount} succeeded, ${failedCount} failed`)
    return { success: successCount, failed: failedCount }
}

// Pull changes from Supabase
export async function pullChanges(workspaceId: string, lastSyncTime: string | null): Promise<{ pulled: number }> {
    if (!isSupabaseConfigured) {
        console.log('[Sync] pullChanges: Supabase not configured')
        return { pulled: 0 }
    }

    const since = lastSyncTime || '1970-01-01T00:00:00Z'
    console.log(`[Sync] pullChanges START: Workspace ${workspaceId}, since ${since}`)

    let totalPulled = 0

    const tables = ['products', 'customers', 'orders', 'invoices']

    for (const table of tables) {
        try {
            console.log(`[Sync] pullChanges: Fetching ${table}...`)
            const { data, error } = (await withTimeout(
                supabase
                    .from(table)
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .gt('updated_at', since) as any,
                30000
            )) as any

            if (error) {
                console.error(`[Sync] pullChanges: Error fetching ${table}:`, error)
                continue
            }

            if (data && data.length > 0) {
                console.log(`[Sync] pullChanges: Processing ${data.length} items for ${table}`)
                const dbTable = (db as any)[table]

                for (const remoteItem of data) {
                    const localItem = await dbTable.get(remoteItem.id)
                    const remoteData = toCamelCase(remoteItem)

                    // Version control: Last Write Wins based on version number or updated_at
                    if (!localItem || localItem.version < (remoteData as any).version) {
                        await dbTable.put({
                            ...remoteData,
                            syncStatus: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        })
                        totalPulled++
                    }
                }
            }
        } catch (err: any) {
            console.error(`[Sync] pullChanges: Critical error fetching ${table}:`, err.message || err)
        }
    }

    console.log(`[Sync] pullChanges COMPLETE: Total items pulled: ${totalPulled}`)
    return { pulled: totalPulled }
}

// Full sync - push then pull
export async function fullSync(userId: string, workspaceId: string, lastSyncTime: string | null): Promise<SyncResult> {
    console.log(`[Sync] fullSync START for User ${userId}, Workspace ${workspaceId}`)
    const errors: string[] = []

    try {
        // Push first
        console.log('[Sync] fullSync: Starting push phase...')
        const { success: pushed, failed } = await pushChanges(userId, workspaceId)
        if (failed > 0) {
            errors.push(`Failed to push ${failed} items`)
        }

        // Then pull
        console.log('[Sync] fullSync: Starting pull phase...')
        const { pulled } = await pullChanges(workspaceId, lastSyncTime)

        const finalResult = {
            success: errors.length === 0,
            pushed,
            pulled,
            errors
        }
        console.log('[Sync] fullSync COMPLETE:', finalResult)
        return finalResult
    } catch (err: any) {
        console.error('[Sync] fullSync CRITICAL ERROR:', err.message || err)
        return {
            success: false,
            pushed: 0,
            pulled: 0,
            errors: [err.message || 'Unknown sync error']
        }
    }
}
