import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './database'
import type { Product, Category, Customer, Order, Invoice, OfflineMutation } from './models'
import { generateId, toSnakeCase, toCamelCase } from '@/lib/utils'
import { supabase } from '@/auth/supabase'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

// ===================
// CATEGORIES HOOKS
// ===================

// ===================
// CATEGORIES HOOKS
// ===================

export function useCategories(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    // 1. Local Cache (Always Source of Truth for UI)
    const categories = useLiveQuery(
        () => workspaceId ? db.categories.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).toArray() : [],
        [workspaceId]
    )

    // 2. Online: Fetch fresh data from Supabase & cleanup cache
    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('categories')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.categories, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.categories.where('workspaceId').equals(workspaceId).toArray()

                        // Delete local items that are 'synced' but missing from server
                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.categories.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Category
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.categories.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return categories ?? []
}

export async function createCategory(workspaceId: string, data: Omit<Category, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>): Promise<Category> {
    const now = new Date().toISOString()
    const id = generateId()

    const category: Category = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any, // Optimistic status
        lastSyncedAt: navigator.onLine ? now : null,
        version: 1,
        isDeleted: false
    }

    if (navigator.onLine) {
        // ONLINE: Write directly to Supabase
        const payload = toSnakeCase({ ...category, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('categories').insert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error // Fail loudly if online
        }

        // Update local cache as synced
        await db.categories.add(category)
    } else {
        // OFFLINE: Write to local mutation queue
        await db.categories.add(category)
        await addToOfflineMutations('categories', id, 'create', category as unknown as Record<string, unknown>, workspaceId)
    }

    return category
}

export async function updateCategory(id: string, data: Partial<Category>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.categories.get(id)
    if (!existing) throw new Error('Category not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (navigator.onLine) {
        // ONLINE: Update Supabase directly
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('categories').update(payload).eq('id', id)

        if (error) throw error

        await db.categories.put(updated)
    } else {
        // OFFLINE: Local mutation
        await db.categories.put(updated)
        await addToOfflineMutations('categories', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteCategory(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.categories.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: navigator.onLine ? 'synced' : 'pending',
        version: existing.version + 1
    } as Category

    if (navigator.onLine) {
        // ONLINE: Delete in Supabase (Soft Delete)
        const { error } = await supabase.from('categories').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error

        await db.categories.put(updated)
    } else {
        // OFFLINE
        await db.categories.put(updated)
        // For delete, we might just need the ID, but passing full updated record is safe or just payload with ID
        await addToOfflineMutations('categories', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// PRODUCTS HOOKS
// ===================

// ===================
// PRODUCTS HOOKS
// ===================

export function useProducts(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const products = useLiveQuery(
        () => workspaceId ? db.products.where('workspaceId').equals(workspaceId).and(p => !p.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.products, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.products.where('workspaceId').equals(workspaceId).toArray()

                        // Delete local items that are 'synced' but missing from server
                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.products.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Product
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.products.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return products ?? []
}

export function useProduct(id: string | undefined) {
    const product = useLiveQuery(
        () => id ? db.products.get(id) : undefined,
        [id]
    )
    return product
}

export async function createProduct(workspaceId: string, data: Omit<Product, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>): Promise<Product> {
    const now = new Date().toISOString()
    const id = generateId()

    const product: Product = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any, // Cast to any or SyncStatus to fix TS error
        lastSyncedAt: navigator.onLine ? now : null,
        version: 1,
        isDeleted: false
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...product, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('products').insert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }

        await db.products.add(product)
    } else {
        // OFFLINE
        await db.products.add(product)
        await addToOfflineMutations('products', id, 'create', product as unknown as Record<string, unknown>, workspaceId)
    }

    return product
}

export async function updateProduct(id: string, data: Partial<Product>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.products.get(id)
    if (!existing) throw new Error('Product not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('products').update(payload).eq('id', id)

        if (error) throw error

        await db.products.put(updated)
    } else {
        // OFFLINE
        await db.products.put(updated)
        await addToOfflineMutations('products', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteProduct(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.products.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Product

    if (navigator.onLine) {
        // ONLINE
        const { error } = await supabase.from('products').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error

        await db.products.put(updated)
    } else {
        // OFFLINE
        await db.products.put(updated)
        await addToOfflineMutations('products', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// CUSTOMERS HOOKS
// ===================

export function useCustomers(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const customers = useLiveQuery(
        () => workspaceId ? db.customers.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('customers')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.customers, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.customers.where('workspaceId').equals(workspaceId).toArray()

                        // Delete local items that are 'synced' but missing from server
                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.customers.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Customer
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.customers.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return customers ?? []
}

export function useCustomer(id: string | undefined) {
    const customer = useLiveQuery(
        () => id ? db.customers.get(id) : undefined,
        [id]
    )
    return customer
}

export async function createCustomer(workspaceId: string, data: Omit<Customer, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalOrders' | 'totalSpent'>): Promise<Customer> {
    const now = new Date().toISOString()
    const id = generateId()

    const customer: Customer = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : null,
        version: 1,
        isDeleted: false,
        totalOrders: 0,
        totalSpent: 0
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...customer, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('customers').insert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }

        await db.customers.add(customer)
    } else {
        // OFFLINE
        await db.customers.add(customer)
        await addToOfflineMutations('customers', id, 'create', customer as unknown as Record<string, unknown>, workspaceId)
    }

    return customer
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.customers.get(id)
    if (!existing) throw new Error('Customer not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('customers').update(payload).eq('id', id)

        if (error) throw error

        await db.customers.put(updated)
    } else {
        // OFFLINE
        await db.customers.put(updated)
        await addToOfflineMutations('customers', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteCustomer(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.customers.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Customer

    if (navigator.onLine) {
        // ONLINE
        const { error } = await supabase.from('customers').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error

        await db.customers.put(updated)
    } else {
        // OFFLINE
        await db.customers.put(updated)
        await addToOfflineMutations('customers', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// ORDERS HOOKS
// ===================

export function useOrders(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const orders = useLiveQuery(
        () => workspaceId ? db.orders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.orders, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.orders.where('workspaceId').equals(workspaceId).toArray()

                        // Delete local items that are 'synced' but missing from server
                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.orders.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Order
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.orders.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return orders ?? []
}

export function useOrder(id: string | undefined) {
    const order = useLiveQuery(
        () => id ? db.orders.get(id) : undefined,
        [id]
    )
    return order
}

export async function createOrder(workspaceId: string, data: Omit<Order, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'>): Promise<Order> {
    const now = new Date().toISOString()
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`
    const id = generateId()

    const order: Order = {
        ...data,
        id,
        workspaceId,
        orderNumber,
        createdAt: now,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : null,
        version: 1,
        isDeleted: false
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...order, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('orders').insert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }

        await db.orders.add(order)
    } else {
        // OFFLINE
        await db.orders.add(order)
        await addToOfflineMutations('orders', id, 'create', order as unknown as Record<string, unknown>, workspaceId)
    }

    // Update customer stats (Locally always, maybe server triggers too but local needs consistency)
    // Ideally this should be an atomic transaction or handled by server function if online.
    // But for hybrid, we do local update.
    const customer = await db.customers.get(data.customerId)
    if (customer) {
        await db.customers.update(data.customerId, {
            totalOrders: customer.totalOrders + 1,
            totalSpent: customer.totalSpent + data.total
        })
    }

    return order
}

export async function updateOrder(id: string, data: Partial<Order>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.orders.get(id)
    if (!existing) throw new Error('Order not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('orders').update(payload).eq('id', id)

        if (error) throw error

        await db.orders.put(updated)
    } else {
        // OFFLINE
        await db.orders.put(updated)
        await addToOfflineMutations('orders', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteOrder(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.orders.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Order

    if (navigator.onLine) {
        // ONLINE
        const { error } = await supabase.from('orders').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error

        await db.orders.put(updated)
    } else {
        // OFFLINE
        await db.orders.put(updated)
        await addToOfflineMutations('orders', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// INVOICES HOOKS
// ===================

export function useInvoices(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const invoices = useLiveQuery(
        () => workspaceId ? db.invoices.where('workspaceId').equals(workspaceId).and(i => !i.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('invoices')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.invoices, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.invoices.where('workspaceId').equals(workspaceId).toArray()

                        // Delete local items that are 'synced' but missing from server
                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.invoices.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Invoice
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.invoices.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return invoices ?? []
}

export function useInvoice(id: string | undefined) {
    const invoice = useLiveQuery(
        () => id ? db.invoices.get(id) : undefined,
        [id]
    )
    return invoice
}

export async function createInvoice(workspaceId: string, data: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceNumber'>): Promise<Invoice> {
    const now = new Date().toISOString()
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`
    const id = generateId()

    const invoice: Invoice = {
        ...data,
        id,
        workspaceId,
        invoiceNumber,
        createdAt: now,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : null,
        version: 1,
        isDeleted: false
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...invoice, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('invoices').insert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }

        await db.invoices.add(invoice)
    } else {
        // OFFLINE
        await db.invoices.add(invoice)
        await addToOfflineMutations('invoices', id, 'create', invoice as unknown as Record<string, unknown>, workspaceId)
    }

    return invoice
}

export async function updateInvoice(id: string, data: Partial<Invoice>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.invoices.get(id)
    if (!existing) throw new Error('Invoice not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        lastSyncedAt: navigator.onLine ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (navigator.onLine) {
        // ONLINE
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('invoices').update(payload).eq('id', id)

        if (error) throw error

        await db.invoices.put(updated)
    } else {
        // OFFLINE
        await db.invoices.put(updated)
        await addToOfflineMutations('invoices', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteInvoice(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.invoices.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (navigator.onLine ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Invoice

    if (navigator.onLine) {
        // ONLINE
        const { error } = await supabase.from('invoices').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error

        await db.invoices.put(updated)
    } else {
        // OFFLINE
        await db.invoices.put(updated)
        await addToOfflineMutations('invoices', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// SYNC QUEUE
// ===================

export function useSyncQueue() {
    const queue = useLiveQuery(() => db.syncQueue.toArray(), [])
    return queue ?? []
}

export function usePendingSyncCount() {
    const count = useLiveQuery(() => db.offline_mutations.where('status').equals('pending').count(), [])
    return count ?? 0
}

export async function addToOfflineMutations(
    entityType: OfflineMutation['entityType'],
    entityId: string,
    operation: OfflineMutation['operation'],
    payload: Record<string, unknown>,
    workspaceId: string
): Promise<void> {
    // 1. Check for existing pending mutation for this entity
    const existing = await db.offline_mutations
        .where('[entityType+entityId+status]')
        .equals([entityType, entityId, 'pending'])
        .first()

    if (existing) {
        // 2. Handle redundant/canceling operations
        if (operation === 'delete') {
            if (existing.operation === 'create') {
                // Case: Created then Deleted while offline -> Remove from queue entirely
                await db.offline_mutations.delete(existing.id)
                return
            }
            // Case: Updated then Deleted while offline -> Change existing update to a delete
            await db.offline_mutations.update(existing.id, {
                operation: 'delete',
                payload: { id: entityId },
                createdAt: new Date().toISOString()
            })
            return
        }

        if (operation === 'update' || operation === 'create') {
            // Case: Multiple updates or re-creating a deleted item
            // Merge payloads to keep the latest state
            await db.offline_mutations.update(existing.id, {
                operation: existing.operation === 'delete' ? 'update' : existing.operation,
                payload: { ...existing.payload, ...payload },
                createdAt: new Date().toISOString()
            })
            return
        }
    }

    // 3. Default: Add new mutation if no pending exists or couldn't be merged
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

export async function removeFromSyncQueue(id: string): Promise<void> {
    await db.syncQueue.delete(id)
}

export async function clearSyncQueue(): Promise<void> {
    await db.syncQueue.clear()
}

export async function clearOfflineMutations(): Promise<void> {
    await db.offline_mutations.clear()

    // Also reset syncStatus for items if possible? 
    // Actually, discarding mutations means we won't sync them.
    // The simplest way to "discard" is just to clear the mutation queue.
    // But local items will still have syncStatus: 'pending'.
    // We should probably reset them to 'synced' (as if they were never intended to be synced) 
    // or just leave them as 'pending' (they will stay local only).
    // The user said "pending info will get deleted or discarded".
}

// ===================
// DASHBOARD STATS
// ===================

export function useDashboardStats(workspaceId: string | undefined) {
    const stats = useLiveQuery(async () => {
        if (!workspaceId) return null
        const [
            productCount,
            categoryCount,
            customerCount,
            orderCount,
            invoiceCount,
            recentOrders,
            pendingInvoices,
            lowStockProducts
        ] = await Promise.all([
            db.products.where('workspaceId').equals(workspaceId).and(p => !p.isDeleted).count(),
            db.categories.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).count(),
            db.customers.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).count(),
            db.orders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).count(),
            db.invoices.where('workspaceId').equals(workspaceId).and(i => !i.isDeleted).count(),
            db.orders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).reverse().sortBy('createdAt').then(orders => orders.slice(0, 5)),
            db.invoices.where('workspaceId').equals(workspaceId).and(inv => !inv.isDeleted && (inv.status === 'sent' || inv.status === 'overdue')).toArray(),
            db.products.where('workspaceId').equals(workspaceId).and(p => !p.isDeleted && p.quantity <= p.minStockLevel).toArray()
        ])

        const totalRevenue = (await db.invoices.where('workspaceId').equals(workspaceId).and(inv => !inv.isDeleted && inv.status === 'paid').toArray())
            .reduce((sum, inv) => sum + inv.total, 0)

        return {
            productCount,
            categoryCount,
            customerCount,
            orderCount,
            invoiceCount,
            recentOrders,
            pendingInvoices,
            lowStockProducts,
            totalRevenue
        }
    }, [])

    return stats ?? {
        productCount: 0,
        categoryCount: 0,
        customerCount: 0,
        orderCount: 0,
        invoiceCount: 0,
        recentOrders: [],
        pendingInvoices: [],
        lowStockProducts: [],
        totalRevenue: 0
    }
}
