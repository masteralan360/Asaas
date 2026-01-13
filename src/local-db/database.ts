import Dexie, { type EntityTable } from 'dexie'
import type { Product, Category, Customer, Order, Invoice, User, SyncQueueItem, Sale, SaleItem, OfflineMutation, Workspace, AppSetting } from './models'

// ERP Database using Dexie.js for IndexedDB
export class ERPDatabase extends Dexie {
    products!: EntityTable<Product, 'id'>
    categories!: EntityTable<Category, 'id'>
    customers!: EntityTable<Customer, 'id'>
    orders!: EntityTable<Order, 'id'>
    invoices!: EntityTable<Invoice, 'id'>
    users!: EntityTable<User, 'id'>
    sales!: EntityTable<Sale, 'id'>
    sale_items!: EntityTable<SaleItem, 'id'>
    workspaces!: EntityTable<Workspace, 'id'>
    syncQueue!: EntityTable<SyncQueueItem, 'id'>
    offline_mutations!: EntityTable<OfflineMutation, 'id'>
    app_settings!: EntityTable<AppSetting, 'key'>

    constructor() {
        super('ERPDatabase')

        this.version(9).stores({
            products: 'id, sku, name, categoryId, workspaceId, currency, syncStatus, updatedAt, isDeleted',
            categories: 'id, name, workspaceId, syncStatus, updatedAt, isDeleted',
            customers: 'id, name, email, workspaceId, syncStatus, updatedAt, isDeleted',
            orders: 'id, orderNumber, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted',
            invoices: 'id, invoiceNumber, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted',
            users: 'id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget',
            sales: 'id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt',
            sale_items: 'id, saleId, productId',
            workspaces: 'id, name, code, syncStatus, updatedAt, isDeleted',
            syncQueue: 'id, entityType, entityId, operation, timestamp',
            offline_mutations: 'id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]',
            app_settings: 'key'
        })
    }
}

// Singleton database instance
export const db = new ERPDatabase()

// Database utility functions
export async function clearDatabase(): Promise<void> {
    await db.transaction('rw', [db.products, db.categories, db.customers, db.orders, db.invoices, db.syncQueue], async () => {
        await db.products.clear()
        await db.categories.clear()
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
