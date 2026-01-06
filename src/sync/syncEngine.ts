import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { db } from '@/local-db'
import type { Table } from 'dexie'
import type { Product, Customer, Order, Invoice, SyncQueueItem } from '@/local-db/models'
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
function getTableName(entityType: SyncQueueItem['entityType']): string {
    return entityType
}

// Timeout helper
async function withTimeout<T>(promise: PromiseLike<T>, ms: number = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Request timed out')), ms)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (err) => {
                clearTimeout(timer)
                reject(err)
            }
        )
    })
}

// Push a single item to Supabase
async function pushItem(item: SyncQueueItem, userId: string): Promise<boolean> {
    console.log(`[Sync] Pushing ${item.entityType} ${item.operation} (${item.entityId})`)
    const tableName = getTableName(item.entityType)
    const data = toSnakeCase(item.data) as Record<string, unknown>
    data.user_id = userId

    // Remove local-only metadata that shouldn't be synced to server
    delete data.sync_status
    delete data.last_synced_at

    try {
        switch (item.operation) {
            case 'create':
            case 'update': {
                console.log(`[Sync] Upserting to ${tableName}...`)
                const { error } = await withTimeout(
                    supabase
                        .from(tableName)
                        .upsert(data, { onConflict: 'id' })
                )

                if (error) {
                    console.error(`[Sync] Supabase error pushing ${item.entityType}:`, error)
                    throw error
                }
                break
            }
            case 'delete': {
                console.log(`[Sync] Deleting from ${tableName}...`)
                const { error } = await withTimeout(
                    supabase
                        .from(tableName)
                        .update({ is_deleted: true, updated_at: new Date().toISOString() })
                        .eq('id', item.entityId)
                )

                if (error) {
                    console.error(`[Sync] Supabase error deleting ${item.entityType}:`, error)
                    throw error
                }
                break
            }
        }
        console.log(`[Sync] Successfully pushed ${item.entityType}`)
        return true
    } catch (error) {
        console.error(`[Sync] Error pushing ${item.entityType}:`, error)
        return false
    }
}

// Push all pending changes to Supabase
export async function pushChanges(userId: string): Promise<{ success: number; failed: number }> {
    if (!isSupabaseConfigured) {
        return { success: 0, failed: 0 }
    }

    const pendingItems = await getPendingItems()
    let success = 0
    let failed = 0

    for (const item of pendingItems) {
        if (item.retryCount >= 3) {
            // Skip items that have failed too many times
            failed++
            continue
        }

        const pushed = await pushItem(item, userId)
        if (pushed) {
            await removeFromQueue(item.id)

            // Update local record sync status
            const table = db[item.entityType as keyof typeof db] as Table<{ id: string; syncStatus: string; lastSyncedAt: string | null }, string>
            await table.update(item.entityId, {
                syncStatus: 'synced',
                lastSyncedAt: new Date().toISOString()
            })

            success++
        } else {
            await incrementRetry(item.id)
            failed++
        }
    }

    return { success, failed }
}

// Pull changes from Supabase
export async function pullChanges(userId: string, lastSyncTime: string | null): Promise<{ pulled: number }> {
    if (!isSupabaseConfigured) {
        console.log('[Sync] Supabase not configured, skipping pull')
        return { pulled: 0 }
    }

    console.log(`[Sync] Pulling changes since ${lastSyncTime || 'beginning'}...`)
    let totalPulled = 0
    const since = lastSyncTime || '1970-01-01T00:00:00Z'

    try {
        // Pull products
        console.log('[Sync] Pulling products...')
        const { data: products, error: productsError } = await withTimeout(
            supabase
                .from('products')
                .select('*')
                .eq('user_id', userId)
                .gt('updated_at', since)
        )

        if (productsError) console.error('[Sync] Error pulling products:', productsError)
        if (!productsError && products) {
            console.log(`[Sync] Found ${products.length} products to update`)
            for (const product of products) {
                const localProduct = await db.products.get(product.id)
                const remoteData = toCamelCase(product) as unknown as Product

                // Compare versions - last write wins
                if (!localProduct || localProduct.version < remoteData.version) {
                    await db.products.put({
                        ...remoteData,
                        syncStatus: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    })
                    totalPulled++
                }
            }
        }

        // Pull customers
        console.log('[Sync] Pulling customers...')
        const { data: customers, error: customersError } = await withTimeout(
            supabase
                .from('customers')
                .select('*')
                .eq('user_id', userId)
                .gt('updated_at', since)
        )

        if (customersError) console.error('[Sync] Error pulling customers:', customersError)
        if (!customersError && customers) {
            console.log(`[Sync] Found ${customers.length} customers to update`)
            for (const customer of customers) {
                const localCustomer = await db.customers.get(customer.id)
                const remoteData = toCamelCase(customer) as unknown as Customer

                if (!localCustomer || localCustomer.version < remoteData.version) {
                    await db.customers.put({
                        ...remoteData,
                        syncStatus: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    })
                    totalPulled++
                }
            }
        }

        // Pull orders
        console.log('[Sync] Pulling orders...')
        const { data: orders, error: ordersError } = await withTimeout(
            supabase
                .from('orders')
                .select('*')
                .eq('user_id', userId)
                .gt('updated_at', since)
        )

        if (ordersError) console.error('[Sync] Error pulling orders:', ordersError)
        if (!ordersError && orders) {
            console.log(`[Sync] Found ${orders.length} orders to update`)
            for (const order of orders) {
                const localOrder = await db.orders.get(order.id)
                const remoteData = toCamelCase(order) as unknown as Order

                if (!localOrder || localOrder.version < remoteData.version) {
                    await db.orders.put({
                        ...remoteData,
                        syncStatus: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    })
                    totalPulled++
                }
            }
        }

        // Pull invoices
        console.log('[Sync] Pulling invoices...')
        const { data: invoices, error: invoicesError } = await withTimeout(
            supabase
                .from('invoices')
                .select('*')
                .eq('user_id', userId)
                .gt('updated_at', since)
        )

        if (invoicesError) console.error('[Sync] Error pulling invoices:', invoicesError)
        if (!invoicesError && invoices) {
            console.log(`[Sync] Found ${invoices.length} invoices to update`)
            for (const invoice of invoices) {
                const localInvoice = await db.invoices.get(invoice.id)
                const remoteData = toCamelCase(invoice) as unknown as Invoice

                if (!localInvoice || localInvoice.version < remoteData.version) {
                    await db.invoices.put({
                        ...remoteData,
                        syncStatus: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    })
                    totalPulled++
                }
            }
        }
    } catch (error) {
        console.error('[Sync] Critical error in pullChanges:', error)
    }

    console.log(`[Sync] Pull complete. Total items pulled: ${totalPulled}`)
    return { pulled: totalPulled }
}

// Full sync - push then pull
export async function fullSync(userId: string, lastSyncTime: string | null): Promise<SyncResult> {
    const errors: string[] = []

    // Push first
    const { success: pushed, failed } = await pushChanges(userId)
    if (failed > 0) {
        errors.push(`Failed to push ${failed} items`)
    }

    // Then pull
    const { pulled } = await pullChanges(userId, lastSyncTime)

    return {
        success: errors.length === 0,
        pushed,
        pulled,
        errors
    }
}
