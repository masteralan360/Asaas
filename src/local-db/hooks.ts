import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from './database'
import type { Product, Category, Customer, Supplier, PurchaseOrder, SalesOrder, Invoice, OfflineMutation, Sale, SaleItem, Employee, Expense, BudgetAllocation, User } from './models'
import { generateId, toSnakeCase, toCamelCase } from '@/lib/utils'
import { convertToStoreBase } from '@/lib/currency'
import { supabase } from '@/auth/supabase'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { isOnline } from '@/lib/network'

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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any, // Optimistic status
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    if (isOnline()) {
        const { data: { session } } = await supabase.auth.getSession()
        const currentUserId = session?.user?.id

        // ONLINE: Write directly to Supabase
        const payload = toSnakeCase({
            ...category,
            userId: currentUserId,
            syncStatus: undefined,
            lastSyncedAt: undefined
        })
        const { error } = await supabase.from('categories').upsert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error // Fail loudly if online
        }

        // Update local cache as synced
        await db.categories.put(category)
    } else {
        // OFFLINE: Write to local mutation queue
        await db.categories.put(category)
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
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
        syncStatus: isOnline() ? 'synced' : 'pending',
        version: existing.version + 1
    } as Category

    if (isOnline()) {
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any, // Cast to any or SyncStatus to fix TS error
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    if (isOnline()) {
        // ONLINE
        const payload = toSnakeCase({ ...product, syncStatus: undefined, lastSyncedAt: undefined, storageName: undefined })
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
        // ONLINE
        const payload = toSnakeCase({ ...data, updatedAt: now, storageName: undefined })
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Product

    if (isOnline()) {
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
// SUPPLIERS HOOKS
// ===================

export function useSuppliers(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const suppliers = useLiveQuery(
        () => workspaceId ? db.suppliers.where('workspaceId').equals(workspaceId).and(s => !s.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('suppliers')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.suppliers, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.suppliers.where('workspaceId').equals(workspaceId).toArray()

                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.suppliers.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Supplier
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.suppliers.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return suppliers ?? []
}

export function useSupplier(id: string | undefined) {
    return useLiveQuery(() => id ? db.suppliers.get(id) : undefined, [id])
}

export async function createSupplier(workspaceId: string, data: Omit<Supplier, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalPurchases' | 'totalSpent'>): Promise<Supplier> {
    const now = new Date().toISOString()
    const id = generateId()

    const supplier: Supplier = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false,
        totalPurchases: 0,
        totalSpent: 0
    }

    if (isOnline()) {
        const payload = toSnakeCase({ ...supplier, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
        await db.suppliers.add(supplier)
    } else {
        await db.suppliers.add(supplier)
        await addToOfflineMutations('suppliers', id, 'create', supplier as unknown as Record<string, unknown>, workspaceId)
    }

    return supplier
}

export async function updateSupplier(id: string, data: Partial<Supplier>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.suppliers.get(id)
    if (!existing) throw new Error('Supplier not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('suppliers').update(payload).eq('id', id)
        if (error) throw error
        await db.suppliers.put(updated)
    } else {
        await db.suppliers.put(updated)
        await addToOfflineMutations('suppliers', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteSupplier(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.suppliers.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Supplier

    if (isOnline()) {
        const { error } = await supabase.from('suppliers').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error
        await db.suppliers.put(updated)
    } else {
        await db.suppliers.put(updated)
        await addToOfflineMutations('suppliers', id, 'delete', { id }, existing.workspaceId)
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

export async function createCustomer(workspaceId: string, data: Omit<Customer, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalOrders' | 'totalSpent' | 'outstandingBalance'>): Promise<Customer> {
    const now = new Date().toISOString()
    const id = generateId()

    const customer: Customer = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false,
        totalOrders: 0,
        totalSpent: 0,
        outstandingBalance: 0
    }

    if (isOnline()) {
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Customer

    if (isOnline()) {
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


// ===================
// PURCHASE ORDERS HOOKS
// ===================

export function usePurchaseOrders(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const orders = useLiveQuery(
        () => workspaceId ? db.purchaseOrders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        if (isOnline && workspaceId) {
            fetchTableFromSupabase('purchase_orders', db.purchaseOrders, workspaceId)
        }
    }, [isOnline, workspaceId])

    return orders ?? []
}

export function usePurchaseOrder(id: string | undefined) {
    return useLiveQuery(() => id ? db.purchaseOrders.get(id) : undefined, [id])
}

export async function createPurchaseOrder(workspaceId: string, data: Omit<PurchaseOrder, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'>): Promise<PurchaseOrder> {
    const now = new Date().toISOString()
    const orderNumber = `PO-${Date.now().toString(36).toUpperCase()}`
    const id = generateId()

    const order: PurchaseOrder = {
        ...data,
        id,
        workspaceId,
        orderNumber,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    await saveEntity('purchase_orders', db.purchaseOrders, order, workspaceId)

    // Increment supplier stats
    const supplier = await db.suppliers.get(data.supplierId)
    if (supplier) {
        await updateSupplier(supplier.id, {
            totalPurchases: (supplier.totalPurchases || 0) + 1,
            totalSpent: (supplier.totalSpent || 0) + data.total // Consider currency? Usually we track raw total or convert if simple for now
        })
    }

    return order
}

export async function updatePurchaseOrder(id: string, data: Partial<PurchaseOrder>): Promise<void> {
    await updateEntity('purchase_orders', db.purchaseOrders, id, data)
}


// ===================
// SALES ORDERS HOOKS
// ===================

export function useSalesOrders(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const orders = useLiveQuery(
        () => workspaceId ? db.salesOrders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        if (isOnline && workspaceId) {
            fetchTableFromSupabase('sales_orders', db.salesOrders, workspaceId)
        }
    }, [isOnline, workspaceId])

    return orders ?? []
}

export function useSalesOrder(id: string | undefined) {
    return useLiveQuery(() => id ? db.salesOrders.get(id) : undefined, [id])
}

export async function createSalesOrder(workspaceId: string, data: Omit<SalesOrder, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'>): Promise<SalesOrder> {
    const now = new Date().toISOString()
    const orderNumber = `SO-${Date.now().toString(36).toUpperCase()}`
    const id = generateId()

    const order: SalesOrder = {
        ...data,
        id,
        workspaceId,
        orderNumber,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    await saveEntity('sales_orders', db.salesOrders, order, workspaceId)

    // Increment customer stats
    const customer = await db.customers.get(data.customerId)
    if (customer) {
        await updateCustomer(customer.id, {
            totalOrders: (customer.totalOrders || 0) + 1,
            totalSpent: (customer.totalSpent || 0) + data.total
        })
    }

    return order
}

export async function updateSalesOrder(id: string, data: Partial<SalesOrder>): Promise<void> {
    await updateEntity('sales_orders', db.salesOrders, id, data)
}

// Helpers for repetitive logic
export async function fetchTableFromSupabase<T extends { id: string, syncStatus: any, lastSyncedAt: any }>(tableName: string, table: any, workspaceId: string) {
    let query = supabase
        .from(tableName)
        .select('*')
        .eq('workspace_id', workspaceId)

    // Only filter by is_deleted for tables that still have that column
    if (tableName !== 'expenses' && tableName !== 'budget_allocations') {
        query = query.eq('is_deleted', false)
    }

    const { data, error } = await query

    if (data && !error) {
        await db.transaction('rw', table, async () => {
            const remoteIds = new Set(data.map(d => d.id))
            const localItems = await table.where('workspaceId').equals(workspaceId).toArray()

            for (const local of (localItems as any[])) {
                if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                    await table.delete(local.id)
                }
            }

            for (const remoteItem of data) {
                const localItem = toCamelCase(remoteItem as any) as unknown as T
                localItem.syncStatus = 'synced'
                localItem.lastSyncedAt = new Date().toISOString()
                await table.put(localItem)
            }
        })
    }
}

async function saveEntity<T extends { id: string }>(tableName: string, table: any, entity: T, workspaceId: string) {
    if (isOnline()) {
        const payload = toSnakeCase({ ...entity, syncStatus: undefined, lastSyncedAt: undefined })
        const { error } = await supabase.from(tableName).insert(payload)
        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }
        await table.add(entity)
    } else {
        await table.add(entity)
        await addToOfflineMutations(tableName as any, entity.id, 'create', entity as unknown as Record<string, unknown>, workspaceId)
    }
}

async function updateEntity<T extends { id: string, workspaceId: string, version: number, lastSyncedAt: any }>(tableName: string, table: any, id: string, data: Partial<T>) {
    const now = new Date().toISOString()
    const existing = await table.get(id)
    if (!existing) throw new Error('Entity not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from(tableName).update(payload).eq('id', id)
        if (error) throw error
        await table.put(updated)
    } else {
        await table.put(updated)
        await addToOfflineMutations(tableName as any, id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
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
                            const existing = await db.invoices.get(remoteItem.id)
                            // If we have pending local changes (like PDF blobs waiting to upload), 
                            // DO NOT overwrite with remote state yet.
                            if (existing && existing.syncStatus === 'pending') {
                                continue
                            }

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

export async function createInvoice(workspaceId: string, data: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'> & { sequenceId?: number }, overrideId?: string): Promise<Invoice> {
    const now = new Date().toISOString()
    const invoiceid = `INV-${Date.now().toString(36).toUpperCase()}`
    const id = overrideId || generateId()

    const invoice: Invoice = {
        ...data,
        id,
        workspaceId,
        invoiceid,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false,
        createdByName: data.createdByName,
        cashierName: data.cashierName,
        sequenceId: data.sequenceId,
        printFormat: data.printFormat
    }


    if (isOnline()) {
        // ONLINE
        // Omit items/blobs and legacy fields that don't belong in the table schema
        // We keep createdBy/created_by in local but map to user_id in remote for RLS
        const { items, currency, subtotal, discount, printMetadata, pdfBlobA4, pdfBlobReceipt, ...rest } = invoice as any

        // @ts-ignore - isSnapshot might be passed but not in Invoice type
        const { isSnapshot, ...finalRest } = rest

        // Get current auth user to satisfy RLS 'user_id' check
        const { data: { session } } = await supabase.auth.getSession()
        const currentUserId = session?.user?.id

        const payload = toSnakeCase({
            ...finalRest,
            userId: currentUserId, // Explicitly set user_id for RLS
            syncStatus: undefined,
            lastSyncedAt: undefined
        })

        // Use upsert instead of insert to handle network retries/collisions gracefully
        const { error } = await supabase.from('invoices').upsert(payload)

        if (error) {
            console.error('Supabase write failed:', error)
            throw error
        }

        // Use put instead of add for local idempotency
        await db.invoices.put(invoice)
    } else {
        // OFFLINE
        await db.invoices.put(invoice)
        await addToOfflineMutations('invoices', id, 'create', invoice as unknown as Record<string, unknown>, workspaceId)
    }

    return invoice
}

/**
 * Specifically for automated Invoice snapshots from Print Preview
 */
export async function saveInvoiceFromSnapshot(workspaceId: string, data: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'>, overrideId?: string): Promise<Invoice> {

    // If an overrideId is provided, check if it already exists to avoid unique constraint errors
    if (overrideId) {
        const existing = await db.invoices.get(overrideId)
        if (existing) {
            await updateInvoice(overrideId, {
                ...data,
                updatedAt: new Date().toISOString()
            })
            return { ...existing, ...data } as Invoice
        }
    }

    return createInvoice(workspaceId, {
        ...data,
        // @ts-ignore - passing extra flag for logic if needed (though now unused in createInvoice payload)
        isSnapshot: true
    }, overrideId)
}

export async function updateInvoice(id: string, data: Partial<Invoice>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.invoices.get(id)
    if (!existing) throw new Error('Invoice not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
        // ONLINE
        // Filter out legacy fields from update payload
        const { items, currency, subtotal, discount, printMetadata, pdfBlobA4, pdfBlobReceipt, ...restData } = data as any
        const payload = toSnakeCase({ ...restData, updatedAt: now })
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
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Invoice

    if (isOnline()) {
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
// SALES HOOKS
// ===================

export function useSales(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()

    const sales = useLiveQuery(
        () => workspaceId ? db.sales.where('workspaceId').equals(workspaceId).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                const { data, error } = await supabase
                    .from('sales')
                    .select(`
                        *,
                        sale_items(
                            *,
                            product:product_id(name, sku, can_be_returned, return_rules)
                        )
                    `)
                    .eq('workspace_id', workspaceId)

                if (data && !error) {
                    // Fetch cashier profiles
                    const cashierIds = Array.from(new Set(data.map((s: any) => s.cashier_id).filter(Boolean)))
                    let profilesMap: Record<string, string> = {}
                    if (cashierIds.length > 0) {
                        const { data: profiles } = await supabase
                            .from('profiles')
                            .select('id, name')
                            .in('id', cashierIds)
                        if (profiles) {
                            profilesMap = profiles.reduce((acc: any, p: any) => ({ ...acc, [p.id]: p.name }), {})
                        }
                    }

                    await db.transaction('rw', [db.sales, db.sale_items], async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.sales.where('workspaceId').equals(workspaceId).toArray()

                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.sales.delete(local.id)
                                await db.sale_items.where('saleId').equals(local.id).delete()
                            }
                        }

                        for (const remoteSale of data) {
                            const { sale_items: remoteItems, ...saleData } = remoteSale as any
                            const localSale = toCamelCase(saleData) as unknown as Sale
                            localSale.syncStatus = 'synced'
                            localSale.lastSyncedAt = new Date().toISOString()

                            // Enrich with cashier name and items for local-first reads
                            const enrichedItems = (remoteItems || []).map((item: any) => ({
                                ...item,
                                product_name: item.product?.name || 'Unknown Product',
                                product_sku: item.product?.sku || '',
                                product_category: item.product?.category || ''
                            }))
                                ; (localSale as any)._enrichedItems = enrichedItems
                                ; (localSale as any)._cashierName = profilesMap[saleData.cashier_id] || 'Staff'

                            await db.sales.put(localSale)

                            if (remoteItems) {
                                for (const item of remoteItems) {
                                    const { product, ...itemData } = item
                                    const localItem = toCamelCase(itemData) as unknown as SaleItem
                                    await db.sale_items.put(localItem)
                                }
                            }
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return sales ?? []
}

/**
 * Maps a local-db Sale (camelCase) to the UI Sale type (snake_case) from @/types.
 * Includes enriched items and cashier name from background sync.
 */
export function toUISale(localSale: any): any {
    const enrichedItems = (localSale._enrichedItems || []).map((item: any) => ({
        ...item,
        // Ensure product object is available for return checks
        product: item.product || {
            name: item.product_name || 'Unknown Product',
            sku: item.product_sku || '',
            can_be_returned: item.can_be_returned ?? true,
            return_rules: item.return_rules
        }
    }))

    return {
        id: localSale.id,
        workspace_id: localSale.workspaceId,
        cashier_id: localSale.cashierId,
        total_amount: localSale.totalAmount,
        settlement_currency: localSale.settlementCurrency,
        exchange_source: localSale.exchangeSource,
        exchange_rate: localSale.exchangeRate,
        exchange_rate_timestamp: localSale.exchangeRateTimestamp,
        exchange_rates: localSale.exchangeRates,
        created_at: localSale.createdAt,
        updated_at: localSale.updatedAt,
        origin: localSale.origin,
        payment_method: localSale.payment_method ?? localSale.paymentMethod,
        cashier_name: localSale._cashierName || 'Staff',
        items: enrichedItems,
        is_returned: localSale.isReturned,
        return_reason: localSale.returnReason,
        returned_at: localSale.returnedAt,
        returned_by: localSale.returnedBy,
        sequenceId: localSale.sequenceId,
        system_verified: localSale.systemVerified,
        system_review_status: localSale.systemReviewStatus,
        system_review_reason: localSale.systemReviewReason,
        notes: localSale.notes
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

        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString()

        const [
            productCount,
            categoryCount,
            customerCount,
            orderCount,
            invoiceCount,
            recentSales,
            pendingInvoices,
            lowStockProducts,
            allSales
        ] = await Promise.all([
            db.products.where('workspaceId').equals(workspaceId).and(p => !p.isDeleted).count(),
            db.categories.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).count(),
            db.customers.where('workspaceId').equals(workspaceId).and(c => !c.isDeleted).count(),
            db.salesOrders.where('workspaceId').equals(workspaceId).and(o => !o.isDeleted).count(),
            db.invoices.where('workspaceId').equals(workspaceId).and(i => !i.isDeleted).count(),
            db.sales.where('workspaceId').equals(workspaceId).and(s => !s.isDeleted).reverse().sortBy('createdAt').then(sales => sales.slice(0, 3)),
            db.invoices.where('workspaceId').equals(workspaceId).and(inv => !inv.isDeleted).reverse().sortBy('createdAt').then(inv => inv.slice(0, 4)),
            db.products.where('workspaceId').equals(workspaceId).and(p => !p.isDeleted && p.quantity <= p.minStockLevel).toArray(),
            db.sales.where('workspaceId').equals(workspaceId).and(s => !s.isDeleted && s.createdAt >= thirtyDaysAgoStr).toArray()
        ])

        // Fetch items for recent sales and trend sales to calculate cost
        const saleIds = Array.from(new Set([...recentSales.map(s => s.id), ...allSales.map(s => s.id)]))
        const allItems = await db.sale_items.where('saleId').anyOf(saleIds).toArray()
        const itemsBySaleId = allItems.reduce((acc, item) => {
            if (!acc[item.saleId]) acc[item.saleId] = []
            acc[item.saleId].push(item)
            return acc
        }, {} as Record<string, any[]>)

        // Calculate multi-currency gross revenue, cost, and profit
        const statsByCurrency: Record<string, { revenue: number, cost: number, profit: number, dailyTrend: Record<string, { revenue: number, cost: number, profit: number }> }> = {}

        allSales.forEach(sale => {
            if (sale.isReturned) return

            const curr = sale.settlementCurrency || 'usd'
            if (!statsByCurrency[curr]) {
                statsByCurrency[curr] = { revenue: 0, cost: 0, profit: 0, dailyTrend: {} }
            }

            const saleItems = itemsBySaleId[sale.id] || []
            let saleRevenue = 0
            let saleCost = 0

            saleItems.forEach(item => {
                const netQuantity = item.quantity - (item.returnedQuantity || 0)
                if (netQuantity <= 0) return

                saleRevenue += (item.convertedUnitPrice || 0) * netQuantity
                saleCost += (item.convertedCostPrice || 0) * netQuantity
            })

            let saleProfit = saleRevenue - saleCost

            statsByCurrency[curr].revenue += saleRevenue
            statsByCurrency[curr].cost += saleCost
            statsByCurrency[curr].profit += saleProfit

            const date = sale.createdAt.split('T')[0]
            if (!statsByCurrency[curr].dailyTrend[date]) {
                statsByCurrency[curr].dailyTrend[date] = { revenue: 0, cost: 0, profit: 0 }
            }
            statsByCurrency[curr].dailyTrend[date].revenue += saleRevenue
            statsByCurrency[curr].dailyTrend[date].cost += saleCost
            statsByCurrency[curr].dailyTrend[date].profit += saleProfit
        })

        return {
            productCount,
            categoryCount,
            customerCount,
            orderCount,
            invoiceCount,
            recentSales,
            recentInvoices: pendingInvoices,
            lowStockProducts,
            statsByCurrency,
            grossRevenueByCurrency: Object.fromEntries(Object.entries(statsByCurrency).map(([c, s]) => [c, s.revenue]))
        }
    }, [workspaceId])

    return stats ?? {
        productCount: 0,
        categoryCount: 0,
        customerCount: 0,
        orderCount: 0,
        invoiceCount: 0,
        recentSales: [],
        recentInvoices: [],
        lowStockProducts: [],
        statsByCurrency: {},
        grossRevenueByCurrency: {}
    }
}

// ===================
// STORAGES HOOKS
// ===================

import type { Storage } from './models'

export function useStorages(workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const storages = useLiveQuery(
        () => workspaceId ? db.storages.where('workspaceId').equals(workspaceId).and(s => !s.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (online && workspaceId) {
                const { data, error } = await supabase
                    .from('storages')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('is_deleted', false)

                if (data && !error) {
                    await db.transaction('rw', db.storages, async () => {
                        const remoteIds = new Set(data.map(d => d.id))
                        const localItems = await db.storages.where('workspaceId').equals(workspaceId).toArray()

                        for (const local of localItems) {
                            if (!remoteIds.has(local.id) && local.syncStatus === 'synced') {
                                await db.storages.delete(local.id)
                            }
                        }

                        for (const remoteItem of data) {
                            const localItem = toCamelCase(remoteItem as any) as unknown as Storage
                            localItem.syncStatus = 'synced'
                            localItem.lastSyncedAt = new Date().toISOString()
                            await db.storages.put(localItem)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [online, workspaceId])

    return storages ?? []
}

export async function createStorage(workspaceId: string, data: { name: string }): Promise<Storage> {
    const now = new Date().toISOString()
    const id = generateId()

    const storage: Storage = {
        id,
        workspaceId,
        name: data.name,
        isSystem: false,
        isProtected: false,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    await db.storages.put(storage)

    await db.storages.put(storage)

    if (isOnline()) {
        const payload = toSnakeCase({
            ...storage,
            syncStatus: undefined,
            lastSyncedAt: undefined,
            version: undefined
        })

        const { error } = await supabase
            .from('storages')
            .insert(payload as any)

        if (error) {
            console.error('[Storage] Create sync failed:', error)
            await db.storages.update(id, { syncStatus: 'pending' })
            await addToOfflineMutations('storages', id, 'create', payload as any, workspaceId)
        }
    } else {
        const payload = toSnakeCase({
            ...storage,
            syncStatus: undefined,
            lastSyncedAt: undefined,
            version: undefined
        })
        await addToOfflineMutations('storages', id, 'create', payload as any, workspaceId)
    }

    return storage
}

export async function updateStorage(id: string, data: Partial<Pick<Storage, 'name'>>): Promise<void> {
    const existing = await db.storages.get(id)
    if (!existing) return

    // Protect system storages from name changes
    if (existing.isSystem && data.name) {
        console.warn('[Storage] Cannot rename system storage')
        return
    }

    const now = new Date().toISOString()
    await db.storages.update(id, { ...data, updatedAt: now, syncStatus: 'pending' })

    if (isOnline()) {
        const { error } = await supabase
            .from('storages')
            .update({ ...toSnakeCase(data), updated_at: now })
            .eq('id', id)

        if (!error) {
            await db.storages.update(id, { syncStatus: 'synced', lastSyncedAt: now })
        } else {
            await addToOfflineMutations('storages', id, 'update', toSnakeCase(data) as any, existing.workspaceId)
        }
    } else {
        await addToOfflineMutations('storages', id, 'update', toSnakeCase(data) as any, existing.workspaceId)
    }
}

export async function deleteStorage(id: string, moveProductsToStorageId: string): Promise<{ success: boolean, movedCount: number }> {
    const existing = await db.storages.get(id)
    if (!existing) return { success: false, movedCount: 0 }

    // Protect system storages
    if (existing.isProtected || existing.isSystem) {
        console.warn('[Storage] Cannot delete protected/system storage')
        return { success: false, movedCount: 0 }
    }

    // Move all products in this storage to the target storage
    const productsToMove = await db.products.where('storageId').equals(id).toArray()
    const now = new Date().toISOString()

    for (const product of productsToMove) {
        await db.products.update(product.id, { storageId: moveProductsToStorageId, updatedAt: now, syncStatus: 'pending' })

        if (isOnline()) {
            const { error } = await supabase
                .from('products')
                .update({ storage_id: moveProductsToStorageId, updated_at: now })
                .eq('id', product.id)

            if (!error) {
                await db.products.update(product.id, { syncStatus: 'synced', lastSyncedAt: now })
            } else {
                await addToOfflineMutations('products', product.id, 'update', { storage_id: moveProductsToStorageId }, existing.workspaceId)
            }
        } else {
            await addToOfflineMutations('products', product.id, 'update', { storage_id: moveProductsToStorageId }, existing.workspaceId)
        }
    }

    // Soft delete the storage
    await db.storages.update(id, { isDeleted: true, updatedAt: now, syncStatus: 'pending' })

    if (isOnline()) {
        const { error } = await supabase
            .from('storages')
            .update({ is_deleted: true, updated_at: now })
            .eq('id', id)

        if (!error) {
            await db.storages.update(id, { syncStatus: 'synced', lastSyncedAt: now })
        } else {
            await addToOfflineMutations('storages', id, 'update', { is_deleted: true } as any, existing.workspaceId)
        }
    } else {
        await addToOfflineMutations('storages', id, 'update', { is_deleted: true } as any, existing.workspaceId)
    }

    return { success: true, movedCount: productsToMove.length }
}

export async function getReserveStorageId(workspaceId: string): Promise<string | null> {
    const reserve = await db.storages.where('workspaceId').equals(workspaceId).and(s => s.name === 'Reserve' && !s.isDeleted).first()
    return reserve?.id ?? null
}

// ===================
// EMPLOYEES HOOKS
// ===================

export function useEmployees(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const employees = useLiveQuery(
        () => workspaceId ? db.employees.where('workspaceId').equals(workspaceId).and(e => !e.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        if (isOnline && workspaceId) {
            fetchTableFromSupabase('employees', db.employees, workspaceId)
        }
    }, [isOnline, workspaceId])

    return employees ?? []
}

export async function createEmployee(workspaceId: string, data: Omit<Employee, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>): Promise<Employee> {
    const now = new Date().toISOString()
    const id = generateId()
    const employee: Employee = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1,
        isDeleted: false
    }

    await saveEntity('employees', db.employees, employee, workspaceId)
    return employee
}

export async function updateEmployee(id: string, data: Partial<Employee>): Promise<void> {
    await updateEntity('employees', db.employees, id, data)
}

export async function deleteEmployee(id: string): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.employees.get(id)
    if (!existing) return

    const updated = {
        ...existing,
        isDeleted: true,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        version: existing.version + 1
    } as Employee

    if (isOnline()) {
        const { error } = await supabase.from('employees').update({ is_deleted: true, updated_at: now }).eq('id', id)
        if (error) throw error
        await db.employees.put(updated)
    } else {
        await db.employees.put(updated)
        await addToOfflineMutations('employees', id, 'delete', { id }, existing.workspaceId)
    }
}

export function useWorkspaceUsers(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const users = useLiveQuery(
        () => workspaceId ? db.users.where('workspaceId').equals(workspaceId).and(u => !u.isDeleted).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId) {
                // Fetch profiles for the workspace
                const { data, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('workspace_id', workspaceId)

                if (data && !error) {
                    await db.transaction('rw', db.users, async () => {
                        for (const remoteUser of data) {
                            const localUser = toCamelCase(remoteUser as any) as unknown as User
                            localUser.syncStatus = 'synced'
                            localUser.lastSyncedAt = new Date().toISOString()
                            await db.users.put(localUser)
                        }
                    })
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId])

    return users ?? []
}

// ===================
// EXPENSES HOOKS
// ===================

export function useExpenses(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const expenses = useLiveQuery(
        () => workspaceId ? db.expenses.where('workspaceId').equals(workspaceId).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        if (isOnline && workspaceId) {
            fetchTableFromSupabase('expenses', db.expenses, workspaceId)
        }
    }, [isOnline, workspaceId])

    return expenses ?? []
}

export async function createExpense(workspaceId: string, data: Omit<Expense, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version'>): Promise<Expense> {
    const now = new Date().toISOString()
    const id = generateId()
    const expense: Expense = {
        ...data,
        id,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : null,
        version: 1
    }

    await saveEntity('expenses', db.expenses, expense, workspaceId)
    return expense
}

export async function updateExpense(id: string, data: Partial<Expense>): Promise<void> {
    const now = new Date().toISOString()
    const existing = await db.expenses.get(id)
    if (!existing) throw new Error('Expense not found')

    const updated = {
        ...existing,
        ...data,
        updatedAt: now,
        syncStatus: (isOnline() ? 'synced' : 'pending') as any,
        lastSyncedAt: isOnline() ? now : existing.lastSyncedAt,
        version: existing.version + 1
    }

    if (isOnline()) {
        const payload = toSnakeCase({ ...data, updatedAt: now })
        const { error } = await supabase.from('expenses').update(payload).eq('id', id)
        if (error) throw error
        await db.expenses.put(updated)
    } else {
        await db.expenses.put(updated)
        await addToOfflineMutations('expenses', id, 'update', updated as unknown as Record<string, unknown>, existing.workspaceId)
    }
}

export async function deleteExpense(id: string): Promise<void> {
    const existing = await db.expenses.get(id)
    if (!existing) return

    if (isOnline()) {
        const { error } = await supabase.from('expenses').delete().eq('id', id)
        if (error) throw error
        await db.expenses.delete(id)
    } else {
        await db.expenses.delete(id)
        await addToOfflineMutations('expenses', id, 'delete', { id }, existing.workspaceId)
    }
}

// ===================
// BUDGET ALLOCATION HOOKS
// ===================

export function useBudgetAllocations(workspaceId: string | undefined) {
    const isOnline = useNetworkStatus()
    const allocations = useLiveQuery(
        () => workspaceId ? db.budgetAllocations.where('workspaceId').equals(workspaceId).toArray() : [],
        [workspaceId]
    )

    useEffect(() => {
        if (isOnline && workspaceId) {
            fetchTableFromSupabase('budget_allocations', db.budgetAllocations, workspaceId)
        }
    }, [isOnline, workspaceId])

    return allocations ?? []
}

export function useBudgetAllocation(workspaceId: string | undefined, month: string | undefined) {
    const isOnline = useNetworkStatus()

    const allocation = useLiveQuery(
        () => (workspaceId && month) ? db.budgetAllocations.where('[workspaceId+month]').equals([workspaceId, month]).first() : undefined,
        [workspaceId, month]
    )

    useEffect(() => {
        async function fetchFromSupabase() {
            if (isOnline && workspaceId && month) {
                // Check if we already have it locally to avoid redundant fetches
                const localExists = await db.budgetAllocations.where('[workspaceId+month]').equals([workspaceId, month]).count()
                if (localExists > 0) return

                const { data, error } = await supabase
                    .from('budget_allocations')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('month', month)
                    .maybeSingle()

                if (data && !error) {
                    const localItem = toCamelCase(data as any) as unknown as BudgetAllocation
                    localItem.syncStatus = 'synced'
                    localItem.lastSyncedAt = new Date().toISOString()
                    await db.budgetAllocations.put(localItem)
                }
            }
        }
        fetchFromSupabase()
    }, [isOnline, workspaceId, month])

    return allocation
}

export function useMonthlyRevenue(workspaceId: string | undefined, monthStr: string | undefined) {
    const isOnline = useNetworkStatus()

    // Sync Effect: Ensure local Dexie has the sales for this month
    useEffect(() => {
        async function syncMonth() {
            if (isOnline && workspaceId && monthStr) {
                const [year, month] = monthStr.split('-').map(Number)
                const monthStart = new Date(year, month - 1, 1).toISOString()
                const monthEnd = new Date(year, month, 0, 23, 59, 59).toISOString()

                const { data, error } = await supabase
                    .from('sales')
                    .select('*, sale_items(*)')
                    .eq('workspace_id', workspaceId)
                    .gte('created_at', monthStart)
                    .lte('created_at', monthEnd)

                if (data && !error) {
                    await db.transaction('rw', [db.sales, db.sale_items], async () => {
                        for (const remoteSale of data) {
                            const { sale_items, ...saleData } = remoteSale as any
                            const localSale = toCamelCase(saleData) as unknown as Sale
                            localSale.syncStatus = 'synced'
                            localSale.lastSyncedAt = new Date().toISOString()
                            await db.sales.put(localSale)

                            if (sale_items) {
                                for (const item of sale_items) {
                                    const localItem = toCamelCase(item) as unknown as SaleItem
                                    await db.sale_items.put(localItem)
                                }
                            }
                        }
                    })
                }
            }
        }
        syncMonth()
    }, [isOnline, workspaceId, monthStr])

    const financials = useLiveQuery(async () => {
        if (!workspaceId || !monthStr) return { revenue: {}, profit: {} }

        const [year, month] = monthStr.split('-').map(Number)
        const monthStart = new Date(year, month - 1, 1).toISOString()
        const monthEnd = new Date(year, month, 0, 23, 59, 59).toISOString()

        const sales = await db.sales
            .where('workspaceId')
            .equals(workspaceId)
            .and(s => !s.isDeleted && !s.isReturned && s.createdAt >= monthStart && s.createdAt <= monthEnd)
            .toArray()

        const saleIds = sales.map(s => s.id)
        const items = await db.sale_items.where('saleId').anyOf(saleIds).toArray()

        const revByCurrency: Record<string, number> = {}
        const profitByCurrency: Record<string, number> = {}

        items.forEach(item => {
            const sale = sales.find(s => s.id === item.saleId)
            if (!sale) return
            const curr = sale.settlementCurrency || 'usd'
            const netQty = item.quantity - (item.returnedQuantity || 0)
            if (netQty <= 0) return

            if (!revByCurrency[curr]) revByCurrency[curr] = 0
            if (!profitByCurrency[curr]) profitByCurrency[curr] = 0

            const itemRev = (item.convertedUnitPrice || 0) * netQty
            const itemCost = (item.convertedCostPrice || 0) * netQty

            revByCurrency[curr] += itemRev
            profitByCurrency[curr] += (itemRev - itemCost)
        })

        return { revenue: revByCurrency, profit: profitByCurrency }
    }, [workspaceId, monthStr])

    return financials ?? { revenue: {}, profit: {} }
}

export async function setBudgetAllocation(workspaceId: string, data: Omit<BudgetAllocation, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version'>): Promise<BudgetAllocation> {
    const now = new Date().toISOString()

    // 1. Check local DB first using the new compound index
    let existing = await db.budgetAllocations.where('[workspaceId+month]').equals([workspaceId, data.month]).first()

    // 2. If not found locally but online, check Supabase to avoid unique constraint violation
    if (!existing && isOnline()) {
        const { data: remoteData, error } = await supabase
            .from('budget_allocations')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('month', data.month)
            .maybeSingle()

        if (remoteData && !error) {
            existing = toCamelCase(remoteData as any) as unknown as BudgetAllocation
            // Sync it locally first so updateEntity can find it
            await db.budgetAllocations.put(existing)
        }
    }

    if (existing) {
        // We do not override 'startPoint' on updates
        await updateEntity('budget_allocations', db.budgetAllocations, existing.id, data as any)
        return { ...existing, ...data } as BudgetAllocation
    } else {
        // Count existing allocations for this workspace to determine start_point
        const existingCount = await db.budgetAllocations.where('workspaceId').equals(workspaceId).count()
        const isStartPoint = existingCount === 0

        const id = generateId()
        const allocation: BudgetAllocation = {
            ...data,
            id,
            workspaceId,
            startPoint: isStartPoint,
            createdAt: now,
            updatedAt: now,
            syncStatus: (isOnline() ? 'synced' : 'pending') as any,
            lastSyncedAt: isOnline() ? now : null,
            version: 1,
        }
        await saveEntity('budget_allocations', db.budgetAllocations, allocation, workspaceId)
        return allocation
    }
}

export function useBudgetLimitReached(
    workspaceId: string | undefined,
    baseCurrency: string,
    rates: { usd_iqd: number; eur_iqd: number; try_iqd: number }
) {
    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const financials = useMonthlyRevenue(workspaceId, monthStr)

    return useLiveQuery(async () => {
        if (!workspaceId) return false

        const [year, month] = monthStr.split('-').map(Number)
        const monthStart = new Date(year, month - 1, 1)
        const monthEnd = new Date(year, month, 0, 23, 59, 59)

        // 1. Get Allocation
        const allocation = await db.budgetAllocations
            .where('[workspaceId+month]')
            .equals([workspaceId, monthStr])
            .first()

        if (!allocation || allocation.amount <= 0) return false

        // 2. Get Expenses for the month
        const allExpenses = await db.expenses
            .where('workspaceId')
            .equals(workspaceId)
            .toArray()

        const monthExpenses = allExpenses.filter(e => {
            const date = new Date(e.dueDate)
            return date >= monthStart && date <= monthEnd
        })

        // 3. Get Employees for Salaries
        const employees = await db.employees
            .where('workspaceId')
            .equals(workspaceId)
            .toArray()

        // 4. Calculate Operational Total (Expenses + Salaries)
        let total = 0
        monthExpenses.forEach(exp => {
            total += convertToStoreBase(exp.amount, exp.currency, baseCurrency, rates)
        })

        employees.forEach(emp => {
            if (emp.salary && emp.salary > 0 && !emp.isFired) {
                total += convertToStoreBase(emp.salary, emp.salaryCurrency, baseCurrency, rates)
            }
        })

        // 5. Calculate Limit
        let limit = 0
        if (allocation.type === 'fixed') {
            limit = convertToStoreBase(allocation.amount, allocation.currency, baseCurrency, rates)
        } else {
            // Percentage of profit
            const totalProfit = Object.entries(financials.profit || {}).reduce(
                (sum, [curr, amt]) => sum + convertToStoreBase(amt, curr, baseCurrency, rates),
                0
            )
            limit = totalProfit * (allocation.amount / 100)
        }

        return limit > 0 && total >= limit
    }, [workspaceId, monthStr, financials, baseCurrency, rates]) ?? false
}

