import Dexie, { type EntityTable } from 'dexie'
import type { Product, Customer, Order, Invoice, User, SyncQueueItem } from './models'

// ERP Database using Dexie.js for IndexedDB
export class ERPDatabase extends Dexie {
    products!: EntityTable<Product, 'id'>
    customers!: EntityTable<Customer, 'id'>
    orders!: EntityTable<Order, 'id'>
    invoices!: EntityTable<Invoice, 'id'>
    users!: EntityTable<User, 'id'>
    syncQueue!: EntityTable<SyncQueueItem, 'id'>

    constructor() {
        super('ERPDatabase')

        this.version(1).stores({
            products: 'id, sku, name, category, syncStatus, updatedAt, isDeleted',
            customers: 'id, name, email, syncStatus, updatedAt, isDeleted',
            orders: 'id, orderNumber, customerId, status, syncStatus, updatedAt, isDeleted',
            invoices: 'id, invoiceNumber, orderId, customerId, status, syncStatus, updatedAt, isDeleted',
            users: 'id, email, role, syncStatus, updatedAt, isDeleted',
            syncQueue: 'id, entityType, entityId, operation, timestamp'
        })
    }
}

// Singleton database instance
export const db = new ERPDatabase()

// Database utility functions
export async function clearDatabase(): Promise<void> {
    await db.transaction('rw', [db.products, db.customers, db.orders, db.invoices, db.syncQueue], async () => {
        await db.products.clear()
        await db.customers.clear()
        await db.orders.clear()
        await db.invoices.clear()
        await db.syncQueue.clear()
    })
}

export async function exportDatabase(): Promise<{
    products: Product[]
    customers: Customer[]
    orders: Order[]
    invoices: Invoice[]
}> {
    const [products, customers, orders, invoices] = await Promise.all([
        db.products.where('isDeleted').equals(0).toArray(),
        db.customers.where('isDeleted').equals(0).toArray(),
        db.orders.where('isDeleted').equals(0).toArray(),
        db.invoices.where('isDeleted').equals(0).toArray(),
    ])

    return { products, customers, orders, invoices }
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
    return await db.syncQueue.count()
}
