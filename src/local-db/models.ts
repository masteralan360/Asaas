// Data Models for ERP System
// All entities include sync metadata for offline-first architecture

export type SyncStatus = 'pending' | 'synced' | 'conflict'

export type UserRole = 'admin' | 'staff' | 'viewer'

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
}

export interface Product extends BaseEntity {
    sku: string
    name: string
    description: string
    category: string
    price: number
    costPrice: number
    quantity: number
    minStockLevel: number
    unit: string
    imageUrl?: string
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
}

export interface Sale extends BaseEntity {
    cashierId: string
    totalAmount: number
    origin: string
}

export interface SaleItem {
    id: string
    saleId: string
    productId: string
    quantity: number
    unitPrice: number
    totalPrice: number
}


// Sync Queue Item for tracking pending changes
export interface SyncQueueItem {
    id: string
    entityType: 'products' | 'customers' | 'orders' | 'invoices' | 'users' | 'sales'
    entityId: string
    operation: 'create' | 'update' | 'delete'
    data: Record<string, unknown>
    timestamp: string
    retryCount: number
}

// Type guards
export function isProduct(entity: BaseEntity): entity is Product {
    return 'sku' in entity && 'price' in entity
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
