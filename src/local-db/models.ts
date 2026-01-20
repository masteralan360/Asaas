// Data Models for ERP System
// All entities include sync metadata for offline-first architecture

export type SyncStatus = 'pending' | 'synced' | 'conflict'

export type UserRole = 'admin' | 'staff' | 'viewer'

export type CurrencyCode = 'usd' | 'eur' | 'iqd' | 'try'

export type IQDDisplayPreference = 'IQD' | 'د.ع'

export interface SyncMetadata {
    syncStatus: SyncStatus
    lastSyncedAt: string | null
    version: number
    isDeleted: boolean
}

export interface BaseEntity extends SyncMetadata {
    id: string
    workspaceId: string
    createdAt: string
    updatedAt: string
}

export interface User extends BaseEntity {
    email: string
    name: string
    role: UserRole
    avatarUrl?: string
    monthlyTarget?: number
    monthlyProgress?: number
}

export interface Product extends BaseEntity {
    sku: string
    name: string
    description: string
    categoryId?: string
    category?: string
    price: number
    costPrice: number
    quantity: number
    minStockLevel: number
    unit: string
    currency: CurrencyCode
    barcode?: string
    imageUrl?: string
    canBeReturned: boolean
    returnRules?: string
}

export interface Category extends BaseEntity {
    name: string
    description?: string
}

export interface Customer extends BaseEntity {
    name: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    notes?: string
    totalOrders: number
    totalSpent: number
}

export interface OrderItem {
    productId: string
    productName: string
    quantity: number
    unitPrice: number
    total: number
    currency: CurrencyCode
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

export interface Order extends BaseEntity {
    orderNumber: string
    customerId: string
    customerName: string
    items: OrderItem[]
    subtotal: number
    tax: number
    discount: number
    total: number
    status: OrderStatus
    notes?: string
    shippingAddress: string
    currency: CurrencyCode
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface Invoice extends BaseEntity {
    invoiceNumber: string
    orderId: string
    customerId: string
    customerName: string
    items: OrderItem[]
    subtotal: number
    tax: number
    discount: number
    total: number
    status: InvoiceStatus
    dueDate: string
    paidAt?: string
    notes?: string
    currency: CurrencyCode
}

export interface Sale extends BaseEntity {
    cashierId: string
    totalAmount: number
    settlementCurrency: CurrencyCode
    exchangeSource: string
    exchangeRate: number
    exchangeRateTimestamp: string
    exchangeRates?: any[]
    origin: string
    payment_method?: 'cash' | 'fib' | 'qicard' | 'zaincash' | 'fastpay'
}

export interface SaleItem {
    id: string
    saleId: string
    productId: string
    quantity: number
    unitPrice: number
    totalPrice: number
    costPrice: number
    convertedCostPrice: number
    originalCurrency: CurrencyCode
    originalUnitPrice: number
    convertedUnitPrice: number
    settlementCurrency: CurrencyCode
    negotiatedPrice?: number
}


// Sync Queue Item for tracking pending changes
export interface SyncQueueItem {
    id: string
    entityType: 'products' | 'customers' | 'orders' | 'invoices' | 'users' | 'sales' | 'categories'
    entityId: string
    operation: 'create' | 'update' | 'delete'
    data: Record<string, unknown>
    timestamp: string
    retryCount: number
}

// Offline Mutation for manual sync queue
export type MutationStatus = 'pending' | 'syncing' | 'failed' | 'synced'

export interface Workspace extends BaseEntity {
    name: string
    code: string
    default_currency: CurrencyCode
    iqd_display_preference: IQDDisplayPreference
    eur_conversion_enabled?: boolean
    try_conversion_enabled?: boolean
    locked_workspace: boolean
    allow_pos: boolean
    allow_customers: boolean
    allow_orders: boolean
    allow_invoices: boolean
}

export interface OfflineMutation {
    id: string
    workspaceId: string
    entityType: 'products' | 'customers' | 'orders' | 'invoices' | 'users' | 'sales' | 'categories' | 'workspaces'
    entityId: string
    operation: 'create' | 'update' | 'delete'
    payload: Record<string, unknown>
    createdAt: string
    status: MutationStatus
    error?: string
}

export interface AppSetting {
    key: string
    value: string
}

// Type guards
export function isProduct(entity: BaseEntity): entity is Product {
    return 'sku' in entity && 'price' in entity && 'currency' in entity
}

export function isCustomer(entity: BaseEntity): entity is Customer {
    return 'phone' in entity && 'totalOrders' in entity
}

export function isOrder(entity: BaseEntity): entity is Order {
    return 'orderNumber' in entity && 'items' in entity && 'status' in entity
}

export function isInvoice(entity: BaseEntity): entity is Invoice {
    return 'invoiceNumber' in entity && 'dueDate' in entity
}
