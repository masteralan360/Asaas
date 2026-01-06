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

// Push a single item to Supabase
async function pushItem(item: SyncQueueItem, userId: string): Promise<boolean> {
    const tableName = getTableName(item.entityType)
    const data = toSnakeCase(item.data)
    data.user_id = userId

    try {
        switch (item.operation) {
            case 'create':
            case 'update': {
                const { error } = await supabase
                    .from(tableName)
                    .upsert(data, { onConflict: 'id' })

                if (error) throw error
                break
            }
            case 'delete': {
                const { error } = await supabase
                    .from(tableName)
                    .update({ is_deleted: true, updated_at: new Date().toISOString() })
                    .eq('id', item.entityId)

                if (error) throw error
                break
            }
        }
        return true
    } catch (error) {
        console.error(`Error pushing ${item.entityType}:`, error)
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
        return { pulled: 0 }
    }

    let totalPulled = 0
    const since = lastSyncTime || '1970-01-01T00:00:00Z'

    // Pull products
    const { data: products, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', since)

    if (!productsError && products) {
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
    const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', since)

    if (!customersError && customers) {
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
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', since)

    if (!ordersError && orders) {
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
    const { data: invoices, error: invoicesError } = await supabase
        .from('invoices')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', since)

    if (!invoicesError && invoices) {
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
