import Dexie, { type EntityTable } from 'dexie'
import type { Product, Category, Customer, Supplier, PurchaseOrder, SalesOrder, Invoice, User, SyncQueueItem, Sale, SaleItem, OfflineMutation, Workspace, AppSetting, Storage, Employee, Expense, BudgetAllocation } from './models'

// Asaas Database using Dexie.js for IndexedDB
export class AsaasDatabase extends Dexie {
    products!: EntityTable<Product, 'id'>
    categories!: EntityTable<Category, 'id'>
    suppliers!: EntityTable<Supplier, 'id'>
    customers!: EntityTable<Customer, 'id'>
    purchaseOrders!: EntityTable<PurchaseOrder, 'id'>
    salesOrders!: EntityTable<SalesOrder, 'id'>
    invoices!: EntityTable<Invoice, 'id'>
    users!: EntityTable<User, 'id'>
    sales!: EntityTable<Sale, 'id'>
    sale_items!: EntityTable<SaleItem, 'id'>
    workspaces!: EntityTable<Workspace, 'id'>
    storages!: EntityTable<Storage, 'id'>
    employees!: EntityTable<Employee, 'id'>
    expenses!: EntityTable<Expense, 'id'>
    budgetAllocations!: EntityTable<BudgetAllocation, 'id'>
    syncQueue!: EntityTable<SyncQueueItem, 'id'>
    offline_mutations!: EntityTable<OfflineMutation, 'id'>
    app_settings!: EntityTable<AppSetting, 'key'>

    constructor() {
        super('AsaasDatabase')

        this.version(25).stores({
            products: 'id, sku, name, categoryId, storageId, workspaceId, currency, syncStatus, updatedAt, isDeleted, canBeReturned',
            categories: 'id, name, workspaceId, syncStatus, updatedAt, isDeleted',
            suppliers: 'id, name, workspaceId, syncStatus, updatedAt, isDeleted',
            customers: 'id, name, phone, email, workspaceId, syncStatus, updatedAt, isDeleted',
            purchaseOrders: 'id, orderNumber, supplierId, status, workspaceId, syncStatus, updatedAt, isDeleted',
            salesOrders: 'id, orderNumber, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted',
            invoices: 'id, invoiceid, orderId, customerId, status, workspaceId, syncStatus, updatedAt, isDeleted, origin, createdBy, cashierName, createdByName, isSnapshot, sequenceId, printFormat',

            users: 'id, email, role, workspaceId, syncStatus, updatedAt, isDeleted, monthlyTarget',
            sales: 'id, cashierId, workspaceId, settlementCurrency, syncStatus, createdAt',
            sale_items: 'id, saleId, productId',
            workspaces: 'id, name, code, syncStatus, updatedAt, isDeleted',
            storages: 'id, name, workspaceId, isSystem, isProtected, syncStatus, updatedAt, isDeleted',
            employees: 'id, name, workspaceId, linkedUserId, syncStatus, updatedAt, isDeleted',
            expenses: 'id, type, category, status, dueDate, snoozeUntil, workspaceId, syncStatus, updatedAt, isDeleted',
            budgetAllocations: 'id, month, type, workspaceId, syncStatus, updatedAt, isDeleted, [workspaceId+month]',
            syncQueue: 'id, entityType, entityId, operation, timestamp',
            offline_mutations: 'id, workspaceId, entityType, entityId, status, createdAt, [entityType+entityId+status]',
            app_settings: 'key'
        })
    }
}


// Singleton database instance
export const db = new AsaasDatabase()

// Database utility functions
export async function clearDatabase(): Promise<void> {
    await db.transaction('rw', [db.products, db.categories, db.suppliers, db.customers, db.purchaseOrders, db.salesOrders, db.invoices, db.syncQueue], async () => {
        await db.products.clear()
        await db.categories.clear()
        await db.suppliers.clear()
        await db.customers.clear()
        await db.purchaseOrders.clear()
        await db.salesOrders.clear()
        await db.invoices.clear()
        await db.syncQueue.clear()
    })
}

export async function exportDatabase(): Promise<{
    products: Product[]
    suppliers: Supplier[]
    customers: Customer[]
    purchaseOrders: PurchaseOrder[]
    salesOrders: SalesOrder[]
    invoices: Invoice[]
}> {
    const [products, consumers, suppliers, purchaseOrders, salesOrders, invoices] = await Promise.all([
        db.products.where('isDeleted').equals(false as any).toArray(),
        db.customers.where('isDeleted').equals(false as any).toArray(),
        db.suppliers.where('isDeleted').equals(false as any).toArray(),
        db.purchaseOrders.where('isDeleted').equals(false as any).toArray(),
        db.salesOrders.where('isDeleted').equals(false as any).toArray(),
        db.invoices.where('isDeleted').equals(false as any).toArray(),
    ])

    return { products, suppliers, customers: consumers, purchaseOrders, salesOrders, invoices }
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
    return await db.syncQueue.count()
}
