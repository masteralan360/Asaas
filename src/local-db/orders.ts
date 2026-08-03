import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { v5 as uuidv5 } from 'uuid'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { getTravelSaleCost } from '@/lib/travelAgency'
import { roundOrderValue } from '@/lib/orderPrecision'
import { convertCurrencyAmountWithSnapshot } from '@/lib/orderCurrency'
import { normalizeOrderAdjustments } from '@/lib/orderAdjustments'
import { isOnline } from '@/lib/network'
import { getOrderLineInventoryQuantity } from '@/lib/orderLineItems'
import { isPositiveQuantity, roundQuantity } from '@/lib/quantity'
import { getMissingPriceBookCostMessage, hasValidProductCost } from '@/lib/productCost'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { isRetriableWebRequestError, normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { generateId } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { supabase } from '@/auth/supabase'

import { db } from './database'
import {
    ORDER_AMOUNT_EPSILON,
    getOrderBalanceAmount,
    getOrderPaidAmount,
    rebuildOrderInstallmentsFromPayments,
    roundOrderAmount
} from './orderInstallments'
import {
    ensurePartnerFacet,
    getBusinessPartnerByAnyId,
    recalculateBusinessPartnerSummary
} from './businessPartners'
import {
    adjustInventoryQuantity,
    getInventoryQuantityForProductStorage,
    hydrateInventoryProductStoragesFromSupabase,
    putInventoryQuantity,
    syncInventoryRowsBestEffort,
    syncProductStockSnapshot
} from './inventory'
import { addToOfflineMutations, fetchTableFromSupabase } from './hooks'
import { resolveReturnStorageId } from './storageUtils'
import {
    calculateStockBatchUnitCost,
    commitStockBatchAllocations,
    createStockBatch,
    getStockBatchSalePlans,
    hydrateStockBatchesForPurchaseOrder,
    refreshStockBatchesFromSupabase,
    restoreStockBatchAllocations,
    shouldCreatePurchaseCostBatch,
    syncStockBatchesBestEffort,
    splitStockBatchAllocationsForReturn
} from './stockBatches'
import type {
    Customer,
    CurrencyCode,
    InstallmentFrequency,
    Inventory,
    Loan,
    OrderInstallment,
    OrderReturn,
    OrderReturnItem,
    OrderPaymentMethod,
    OrderPaymentStatus,
    OrderType,
    PaymentTransaction,
    PurchaseOrder,
    PurchaseOrderStatus,
    SalesOrder,
    SalesOrderItem,
    SalesOrderStatus,
    StockBatch,
    StockBatchAllocation,
    Supplier,
    TravelAgencySale
} from './models'
import { appendPaymentTransaction } from './payments'

export function isOrderFinancingMethod(method?: OrderPaymentMethod | null): method is 'loan' | 'installments' {
    return method === 'loan' || method === 'installments'
}

type SimpleEntityTableName = 'customers' | 'suppliers'
type OrderTableName = 'sales_orders' | 'purchase_orders'
type OrderInstallmentTableName = 'order_installments'
type SyncableTableName = SimpleEntityTableName
    | OrderTableName
    | OrderInstallmentTableName
    | 'products'
    | 'payment_transactions'
    | 'loans'
    | 'loan_installments'
    | 'loan_payments'
    | 'order_returns'
    | 'order_return_items'

const PURCHASE_BATCH_UUID_NAMESPACE = '82244d4d-29dd-55b5-a907-50f74e8b49bb'

type BaseEntityPayload = {
    id: string
    workspaceId: string
    createdAt: string
    updatedAt: string
    syncStatus: 'pending' | 'synced' | 'conflict'
    lastSyncedAt: string | null
    version: number
    isDeleted: boolean
}

type CreateOrderInput<TOrder extends SalesOrder | PurchaseOrder> = Omit<
    TOrder,
    'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'
> & {
    /**
     * The timestamp captured when the order form was opened. It is optional
     * so all existing callers continue to default to the save timestamp.
     */
    createdAt?: string
}

type OrderWithApproval = Pick<
    SalesOrder | PurchaseOrder,
    'approvalStatus' | 'approvalRequestedAt' | 'approvalRequestedBy' | 'approvalReviewedAt' | 'approvalReviewedBy'
>

function shouldUseCloudBusinessData(workspaceId?: string | null) {
    return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

function roundAmount(amount: number, _currency: CurrencyCode) {
    return roundOrderValue(amount)
}

async function runMutation<T>(label: string, promiseFactory: () => PromiseLike<T>): Promise<T> {
    return runSupabaseAction(label, promiseFactory)
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return {
            syncStatus: 'synced' as const,
            lastSyncedAt: timestamp
        }
    }

    return {
        syncStatus: 'pending' as const,
        lastSyncedAt: null
    }
}

function sanitizeSyncPayload(tableName: SyncableTableName, entity: Record<string, unknown>) {
    const payload = { ...entity }
    delete payload.syncStatus
    delete payload.lastSyncedAt

    const snakePayload = Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value])
    )

    if (tableName === 'products') {
        // skuKey is a Dexie-only lookup field used for local duplicate-SKU checks.
        // It must never be sent to the products table.
        delete snakePayload.sku_key
        // Product stock is a derived snapshot of inventory, never an
        // independently synced value.
        delete snakePayload.quantity
        delete snakePayload.storage_id
        delete snakePayload.storage_name
    }

    if (tableName === 'customers' || tableName === 'suppliers') {
        delete snakePayload.is_locked
    }

    return snakePayload
}

async function markEntitiesSynced(tableName: SyncableTableName, ids: string[]) {
    const syncedAt = new Date().toISOString()
    const table = (db as unknown as Record<string, { update: (id: string, changes: Record<string, unknown>) => Promise<number> }>)[tableName]
    await Promise.all(ids.map((id) => table.update(id, { syncStatus: 'synced', lastSyncedAt: syncedAt })))
}

async function queueOfflineUpserts(tableName: SyncableTableName, entities: Array<{ id: string; version: number } & Record<string, unknown>>, workspaceId: string) {
    await Promise.all(entities.map((entity) =>
        addToOfflineMutations(
            tableName,
            entity.id,
            entity.version > 1 ? 'update' : 'create',
            entity,
            workspaceId
        )
    ))
}

type SyncUpsertOptions = {
    /**
     * Payment settlements must not appear successful when their linked order
     * is rejected by the server. Non-retriable errors are surfaced to the
     * caller so it can reverse the payment instead of silently queueing an
     * impossible order mutation.
     */
    throwOnNonRetriableError?: boolean
}

async function syncUpsertEntities(
    tableName: SyncableTableName,
    entities: Array<{ id: string; version: number } & Record<string, unknown>>,
    workspaceId: string,
    options: SyncUpsertOptions = {}
) {
    if (!entities.length || !shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await queueOfflineUpserts(tableName, entities, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const payload = entities.map((entity) => sanitizeSyncPayload(tableName, entity))
        const { error } = await runMutation(`${tableName}.sync`, () => client.from(tableName).upsert(payload))
        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, entities.map((entity) => entity.id))
    } catch (error) {
        console.error(`[Orders] Failed to sync ${tableName}:`, error)

        if (options.throwOnNonRetriableError && !isRetriableWebRequestError(error)) {
            throw normalizeSupabaseActionError(error)
        }

        await queueOfflineUpserts(tableName, entities, workspaceId)
    }
}

async function syncSoftDelete(tableName: SimpleEntityTableName | OrderTableName | OrderInstallmentTableName, entityId: string, workspaceId: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId }, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const { error } = await runMutation(`${tableName}.delete`, () =>
            client
                .from(tableName)
                .update({ is_deleted: true, updated_at: new Date().toISOString() })
                .eq('id', entityId)
        )
        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, [entityId])
    } catch (error) {
        console.error(`[Orders] Failed to delete ${tableName}:`, error)
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId }, workspaceId)
    }
}

export function isOrderApprovalRequested(order: OrderWithApproval) {
    return order.approvalStatus === 'requested'
}

function buildApprovalReviewPatch<T extends SalesOrder | PurchaseOrder>(
    existing: T,
    reviewedBy?: string | null
): Pick<T, 'approvalStatus' | 'approvalReviewedBy' | 'approvalReviewedAt' | 'updatedAt' | 'version' | 'syncStatus' | 'lastSyncedAt'> {
    const now = new Date().toISOString()
    return {
        approvalStatus: 'approved',
        approvalReviewedBy: reviewedBy ?? null,
        approvalReviewedAt: now,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    } as Pick<T, 'approvalStatus' | 'approvalReviewedBy' | 'approvalReviewedAt' | 'updatedAt' | 'version' | 'syncStatus' | 'lastSyncedAt'>
}

async function generateDocumentNumber(tableName: OrderTableName, workspaceId: string) {
    const prefix = tableName === 'sales_orders' ? 'SO' : 'PO'
    const year = new Date().getFullYear()
    const rows = await (db as unknown as Record<OrderTableName, { where: (index: string) => { equals: (value: string) => { toArray: () => Promise<Array<{ createdAt: string }>> } } }>)[tableName]
        .where('workspaceId')
        .equals(workspaceId)
        .toArray()
    const sequence = rows.filter((row) => row.createdAt.startsWith(`${year}-`)).length + 1
    return `${prefix}-${year}-${String(sequence).padStart(5, '0')}`
}

async function recalculateCustomerSummary(workspaceId: string, customerId: string) {
    const customer = await db.customers.get(customerId)
    if (!customer || customer.isDeleted) {
        return customer
    }

    const orders = await db.sales_orders
        .where('customerId')
        .equals(customerId)
        .and((item) => !item.isDeleted)
        .toArray()

    const activeOrders = orders.filter((order) => order.status !== 'cancelled')
    const totalOrders = activeOrders.length
    const totalSpent = roundAmount(
        activeOrders
            .filter((order) => order.status === 'completed')
            .reduce(
                (sum, order) => sum + convertCurrencyAmountWithSnapshot(order.total, order.currency, customer.defaultCurrency, order.exchangeRates),
                0
            ),
        customer.defaultCurrency
    )
    const outstandingBalance = roundAmount(
        activeOrders
            .filter((order) =>
                (order.status === 'pending' || order.status === 'completed')
                && getOrderBalanceAmount(order) > 0
            )
            .reduce(
                (sum, order) => sum + convertCurrencyAmountWithSnapshot(
                    getOrderBalanceAmount(order),
                    order.currency,
                    customer.defaultCurrency,
                    order.exchangeRates
                ),
                0
            ),
        customer.defaultCurrency
    )

    if (
        customer.totalOrders === totalOrders
        && customer.totalSpent === totalSpent
        && customer.outstandingBalance === outstandingBalance
    ) {
        return customer
    }

    const now = new Date().toISOString()
    const updated: Customer = {
        ...customer,
        totalOrders,
        totalSpent,
        outstandingBalance,
        updatedAt: now,
        version: customer.version + 1,
        ...getSyncMetadata(workspaceId, now)
    }

    await db.customers.put(updated)
    await syncUpsertEntities('customers', [updated as unknown as Record<string, unknown> & { id: string; version: number }], workspaceId)
    return updated
}

function convertTravelSupplierCostForSupplier(sale: TravelAgencySale, supplierCurrency: CurrencyCode) {
    return convertCurrencyAmountWithSnapshot(
        getTravelSaleCost(sale),
        sale.currency,
        supplierCurrency,
        sale.exchangeRateSnapshot ? [sale.exchangeRateSnapshot] as any : undefined
    )
}

export async function recalculateSupplierSummary(workspaceId: string, supplierId: string) {
    const supplier = await db.suppliers.get(supplierId)
    if (!supplier || supplier.isDeleted) {
        return supplier
    }

    const [orders, travelSales] = await Promise.all([
        db.purchase_orders
            .where('supplierId')
            .equals(supplierId)
            .and((item) => !item.isDeleted)
            .toArray(),
        db.travel_agency_sales
            .where('supplierId')
            .equals(supplierId)
            .and((item) => !item.isDeleted)
            .toArray()
    ])

    const activeOrders = orders.filter((order) => order.status !== 'cancelled')
    const activeTravelSales = travelSales.filter((sale) => sale.status !== 'draft')
    const purchaseOrderSpent = activeOrders
        .filter((order) => order.status === 'received' || order.status === 'completed')
        .reduce(
            (sum, order) => sum + convertCurrencyAmountWithSnapshot(order.total, order.currency, supplier.defaultCurrency, order.exchangeRates),
            0
        )
    const travelSalesSpent = activeTravelSales.reduce(
        (sum, sale) => sum + convertTravelSupplierCostForSupplier(sale, supplier.defaultCurrency),
        0
    )
    const totalPurchases = activeOrders.length + activeTravelSales.length
    const totalSpent = roundAmount(
        purchaseOrderSpent + travelSalesSpent,
        supplier.defaultCurrency
    )

    if (supplier.totalPurchases === totalPurchases && supplier.totalSpent === totalSpent) {
        return supplier
    }

    const now = new Date().toISOString()
    const updated: Supplier = {
        ...supplier,
        totalPurchases,
        totalSpent,
        updatedAt: now,
        version: supplier.version + 1,
        ...getSyncMetadata(workspaceId, now)
    }

    await db.suppliers.put(updated)
    await syncUpsertEntities('suppliers', [updated as unknown as Record<string, unknown> & { id: string; version: number }], workspaceId)
    return updated
}

export async function recalculateAllSupplierSummaries(workspaceId: string) {
    const suppliers = await db.suppliers
        .where('workspaceId')
        .equals(workspaceId)
        .and((item) => !item.isDeleted)
        .toArray()

    await Promise.all(suppliers.map((supplier) => recalculateSupplierSummary(workspaceId, supplier.id)))
}

async function resolveCustomerBusinessPartner(customerId?: string | null, businessPartnerId?: string | null) {
    const directPartnerId = typeof businessPartnerId === 'string' && businessPartnerId.trim().length > 0
        ? businessPartnerId.trim()
        : typeof customerId === 'string'
            ? customerId.trim()
            : ''
    if (directPartnerId) {
        const partner = await getBusinessPartnerByAnyId(directPartnerId)
        if (partner && !partner.isDeleted && !partner.mergedIntoBusinessPartnerId) {
            return partner
        }
    }

    const facetId = typeof customerId === 'string' ? customerId.trim() : ''
    if (!facetId) {
        return undefined
    }

    const customer = await db.customers.get(facetId)
    if (customer?.businessPartnerId) {
        const partner = await db.business_partners.get(customer.businessPartnerId)
        if (partner && !partner.isDeleted && !partner.mergedIntoBusinessPartnerId) {
            return partner
        }
    }

    return undefined
}

async function resolveSupplierBusinessPartner(supplierId?: string | null, businessPartnerId?: string | null) {
    const directPartnerId = typeof businessPartnerId === 'string' && businessPartnerId.trim().length > 0
        ? businessPartnerId.trim()
        : typeof supplierId === 'string'
            ? supplierId.trim()
            : ''
    if (directPartnerId) {
        const partner = await getBusinessPartnerByAnyId(directPartnerId)
        if (partner && !partner.isDeleted && !partner.mergedIntoBusinessPartnerId) {
            return partner
        }
    }

    const facetId = typeof supplierId === 'string' ? supplierId.trim() : ''
    if (!facetId) {
        return undefined
    }

    const supplier = await db.suppliers.get(facetId)
    if (supplier?.businessPartnerId) {
        const partner = await db.business_partners.get(supplier.businessPartnerId)
        if (partner && !partner.isDeleted && !partner.mergedIntoBusinessPartnerId) {
            return partner
        }
    }

    return undefined
}

async function normalizeSalesOrderCounterparty(
    data: Pick<SalesOrder, 'businessPartnerId' | 'customerId' | 'customerName'>
) {
    const partner = await resolveCustomerBusinessPartner(data.customerId, data.businessPartnerId)
    if (!partner) {
        throw new Error('Customer not found')
    }

    const customerFacet = await ensurePartnerFacet(partner.id, 'customer')
    return {
        businessPartnerId: partner.id,
        customerId: customerFacet.id,
        customerName: data.customerName || partner.name
    }
}

async function normalizePurchaseOrderCounterparty(
    data: Pick<PurchaseOrder, 'businessPartnerId' | 'supplierId' | 'supplierName'>
) {
    const partner = await resolveSupplierBusinessPartner(data.supplierId, data.businessPartnerId)
    if (!partner) {
        throw new Error('Supplier not found')
    }

    const supplierFacet = await ensurePartnerFacet(partner.id, 'supplier')
    return {
        businessPartnerId: partner.id,
        supplierId: supplierFacet.id,
        supplierName: data.supplierName || partner.name
    }
}

async function recalculateCustomerAndPartnerSummaries(workspaceId: string, customerId?: string | null, businessPartnerId?: string | null) {
    const tasks: Array<Promise<unknown>> = []
    if (customerId) {
        tasks.push(recalculateCustomerSummary(workspaceId, customerId))
    }
    if (businessPartnerId) {
        tasks.push(recalculateBusinessPartnerSummary(workspaceId, businessPartnerId))
    }
    await Promise.all(tasks)
}

async function recalculateSupplierAndPartnerSummaries(workspaceId: string, supplierId?: string | null, businessPartnerId?: string | null) {
    const tasks: Array<Promise<unknown>> = []
    if (supplierId) {
        tasks.push(recalculateSupplierSummary(workspaceId, supplierId))
    }
    if (businessPartnerId) {
        tasks.push(recalculateBusinessPartnerSummary(workspaceId, businessPartnerId))
    }
    await Promise.all(tasks)
}

function buildBaseEntity<T extends Record<string, unknown>>(workspaceId: string, data: T): T & BaseEntityPayload {
    const now = new Date().toISOString()
    const requestedCreatedAt = typeof data.createdAt === 'string' ? new Date(data.createdAt) : null
    const createdAt = requestedCreatedAt && !Number.isNaN(requestedCreatedAt.valueOf())
        ? requestedCreatedAt.toISOString()
        : now

    return {
        ...data,
        id: generateId(),
        workspaceId,
        createdAt,
        updatedAt: now,
        version: 1,
        isDeleted: false,
        isLocked: false,
        ...getSyncMetadata(workspaceId, now)
    }
}

export function useCustomerSalesOrders(customerId: string | undefined, workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const orders = useLiveQuery(
        async () => {
            if (!customerId) return []
            const partner = await resolveCustomerBusinessPartner(customerId, customerId)
            const rows = await db.sales_orders
                .where('workspaceId')
                .equals(workspaceId || '')
                .and((item) => {
                    if (item.isDeleted) {
                        return false
                    }

                    if (!partner) {
                        return item.customerId === customerId
                    }

                    return item.businessPartnerId === partner.id
                        || item.customerId === customerId
                        || Boolean(partner.customerFacetId && item.customerId === partner.customerFacetId)
                })
                .toArray()
            return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        },
        [customerId, workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            fetchTableFromSupabase('sales_orders', db.sales_orders, workspaceId)
        }
    }, [online, workspaceId])

    return orders ?? []
}


export function useSupplierPurchaseOrders(supplierId: string | undefined, workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const orders = useLiveQuery(
        async () => {
            if (!supplierId) return []
            const partner = await resolveSupplierBusinessPartner(supplierId, supplierId)
            const rows = await db.purchase_orders
                .where('workspaceId')
                .equals(workspaceId || '')
                .and((item) => {
                    if (item.isDeleted) {
                        return false
                    }

                    if (!partner) {
                        return item.supplierId === supplierId
                    }

                    return item.businessPartnerId === partner.id
                        || item.supplierId === supplierId
                        || Boolean(partner.supplierFacetId && item.supplierId === partner.supplierFacetId)
                })
                .toArray()
            return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        },
        [supplierId, workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            fetchTableFromSupabase('purchase_orders', db.purchase_orders, workspaceId)
        }
    }, [online, workspaceId])

    return orders ?? []
}


function buildInventoryReservationKey(productId: string, storageId: string) {
    return `${productId}:${storageId}`
}

function resolveSalesOrderItemStorageId(order: SalesOrder, item: SalesOrder['items'][number]) {
    return item.storageId || order.sourceStorageId || null
}

function resolvePurchaseOrderItemStorageId(order: PurchaseOrder, item: PurchaseOrder['items'][number]) {
    return item.storageId || order.destinationStorageId || null
}

async function getReservedQuantityMaps(workspaceId: string, excludeOrderId?: string) {
    const orders = await db.sales_orders
        .where('workspaceId')
        .equals(workspaceId)
        .and((item) => !item.isDeleted && item.status === 'pending' && item.id !== excludeOrderId)
        .toArray()

    const reservedByStorage = new Map<string, number>()
    const reservedWithoutStorage = new Map<string, number>()
    for (const order of orders) {
        for (const item of order.items) {
            const storageId = resolveSalesOrderItemStorageId(order, item)
            const reservedQuantity = getOrderLineInventoryQuantity(item)
            if (storageId) {
                const key = buildInventoryReservationKey(item.productId, storageId)
                reservedByStorage.set(key, (reservedByStorage.get(key) || 0) + reservedQuantity)
                continue
            }

            reservedWithoutStorage.set(item.productId, (reservedWithoutStorage.get(item.productId) || 0) + reservedQuantity)
        }
    }

    return {
        reservedByStorage,
        reservedWithoutStorage
    }
}

async function assertSalesStockAvailable(order: SalesOrder, excludeOrderId?: string) {
    const { reservedByStorage, reservedWithoutStorage } = await getReservedQuantityMaps(order.workspaceId, excludeOrderId)
    const productIds = Array.from(new Set(order.items.map((item) => item.productId)))
    const products = await db.products.where('id').anyOf(productIds).toArray()
    const productMap = new Map(products.map((product) => [product.id, product]))

    for (const item of order.items) {
        const product = productMap.get(item.productId)
        if (!product || product.isDeleted) {
            throw new Error(`Product not found: ${item.productName}`)
        }
        if (!hasValidProductCost(product.costPrice)) {
            throw new Error(`${product.name} cannot be sold until a cost is added.`)
        }

        const storageId = resolveSalesOrderItemStorageId(order, item)
        if (!storageId) {
            throw new Error(`Select a source storage for ${item.productName}`)
        }

        const storageQuantity = await getInventoryQuantityForProductStorage(item.productId, storageId)
        const storageReserved = reservedByStorage.get(buildInventoryReservationKey(item.productId, storageId)) || 0
        const globalReserved = reservedWithoutStorage.get(item.productId) || 0
        const available = storageQuantity - storageReserved - globalReserved
        const requiredQuantity = getOrderLineInventoryQuantity(item)
        if (available < requiredQuantity) {
            throw new Error(`Insufficient stock for ${item.productName}`)
        }
    }
}

async function assertSalesProductsHaveCosts(order: SalesOrder) {
    const productIds = Array.from(new Set(order.items.map((item) => item.productId)))
    const products = await db.products.where('id').anyOf(productIds).toArray()
    const productMap = new Map(products.map((product) => [product.id, product]))

    for (const item of order.items) {
        const product = productMap.get(item.productId)
        if (!product || product.isDeleted) {
            throw new Error(`Product not found: ${item.productName}`)
        }
        if (!hasValidProductCost(product.costPrice)) {
            throw new Error(`${product.name} cannot be sold until a cost is added.`)
        }
    }

    const partner = order.businessPartnerId
        ? await db.business_partners.get(order.businessPartnerId)
        : undefined
    const priceBook = partner?.priceBookId
        ? await db.price_books.get(partner.priceBookId)
        : undefined

    if (!priceBook || priceBook.isDeleted) {
        return
    }

    const priceBookItems = await db.price_book_items
        .where('priceBookId')
        .equals(priceBook.id)
        .toArray()
    const itemsByProductId = new Map(
        priceBookItems
            .filter((item) => !item.isDeleted)
            .map((item) => [item.productId, item])
    )

    for (const item of order.items) {
        const product = productMap.get(item.productId)
        const priceBookItem = itemsByProductId.get(item.productId)
        if (priceBookItem && !hasValidProductCost(priceBookItem.costPrice)) {
            throw new Error(getMissingPriceBookCostMessage(product?.name || item.productName, priceBook.name))
        }
    }
}

async function deductInventoryForSalesOrder(order: SalesOrder) {
    const now = new Date().toISOString()
    const changedInventoryRows: Inventory[] = []
    const changedBatches: StockBatch[] = []
    const updatedItems = [...order.items]

    await refreshStockBatchesFromSupabase(order.workspaceId)
    await Promise.all(order.items.map(async (item) => {
        const storageId = resolveSalesOrderItemStorageId(order, item)
        if (!storageId) {
            throw new Error(`Select a source storage for ${item.productName}`)
        }

        await hydrateInventoryProductStoragesFromSupabase(
            order.workspaceId,
            item.productId,
            [storageId]
        )
    }))
    const salePlans = await getStockBatchSalePlans(order.items.map((item) => ({
        productId: item.productId,
        storageId: resolveSalesOrderItemStorageId(order, item) as string,
        quantity: getOrderLineInventoryQuantity(item),
        selectedBatchAllocations: item.batchAllocations == null
            ? undefined
            : item.batchAllocations.map((allocation) => ({
                batchId: allocation.batchId,
                quantity: allocation.quantity
            }))
    })))

    await db.transaction(
        'rw',
        [db.inventory, db.products, db.storages, db.stock_batches],
        async () => {
            for (const [itemIndex, item] of order.items.entries()) {
                const product = await db.products.get(item.productId)
                if (!product || product.isDeleted) {
                    throw new Error(`Product not found: ${item.productName}`)
                }

                const storageId = resolveSalesOrderItemStorageId(order, item)
                if (!storageId) {
                    throw new Error(`Select a source storage for ${item.productName}`)
                }

                const salePlan = salePlans[itemIndex]
                const costPrice = calculateStockBatchUnitCost(
                    salePlan.allocations,
                    item.costPrice,
                    item.originalCurrency,
                    (amount, from, to) => convertCurrencyAmountWithSnapshot(
                        amount,
                        from,
                        to,
                        order.exchangeRates
                    ),
                    salePlan.requestedQuantity
                )
                const convertedCostPrice = calculateStockBatchUnitCost(
                    salePlan.allocations,
                    item.convertedCostPrice,
                    order.currency,
                    (amount, from, to) => convertCurrencyAmountWithSnapshot(
                        amount,
                        from,
                        to,
                        order.exchangeRates
                    ),
                    salePlan.requestedQuantity
                )

                const committedBatches = await commitStockBatchAllocations(
                    order.workspaceId,
                    item.productId,
                    storageId,
                    salePlan.allocations,
                    {
                        timestamp: now,
                        skipRemoteSync: true
                    }
                )
                changedBatches.push(...committedBatches)

                const currentInventoryQuantity = await getInventoryQuantityForProductStorage(
                    item.productId,
                    storageId
                )
                const inventoryQuantity = getOrderLineInventoryQuantity(item)
                const changedInventoryRow = await putInventoryQuantity(
                    order.workspaceId,
                    item.productId,
                    storageId,
                    currentInventoryQuantity - inventoryQuantity,
                    now
                )
                const updatedProduct = await syncProductStockSnapshot(item.productId, now)

                if (!updatedProduct) {
                    throw new Error(`Product not found: ${item.productName}`)
                }

                if (changedInventoryRow) {
                    changedInventoryRows.push(changedInventoryRow)
                }

                updatedItems[itemIndex] = {
                    ...item,
                    reservedQuantity: inventoryQuantity,
                    fulfilledQuantity: inventoryQuantity,
                    costPrice,
                    convertedCostPrice,
                    batchAllocations: salePlan.allocations.length > 0 ? salePlan.allocations : null
                }
            }
        }
    )

    await Promise.all([
        syncInventoryRowsBestEffort(changedInventoryRows, order.workspaceId),
        syncStockBatchesBestEffort(changedBatches, order.workspaceId)
    ])

    const { evaluateReorderTransferRulesForProduct } = await import('./reorderTransferRules')
    await Promise.all(Array.from(new Set(order.items.map((item) => item.productId))).map((productId) =>
        evaluateReorderTransferRulesForProduct(order.workspaceId, productId)
    ))

    return {
        updatedItems
    }
}

type OrderPaymentInput = {
    total: number
    currency: CurrencyCode
    isPaid?: boolean
    paidAmount?: number
    initialPaymentAmount?: number
    paymentMethod?: OrderPaymentMethod
    paidAt?: string | null
    isInstallmentBased?: boolean
    installmentCount?: number
    installmentFrequency?: InstallmentFrequency | null
    firstDueDate?: string | null
}

function normalizeOrderPaymentState(input: OrderPaymentInput, now: string) {
    const total = roundOrderAmount(Math.max(0, Number(input.total || 0)), input.currency)
    const paymentMethod = input.paymentMethod || 'cash'
    const isFinanced = isOrderFinancingMethod(paymentMethod)
    const requestedPaidAmount = isFinanced
        ? Number(input.initialPaymentAmount ?? input.paidAmount ?? 0)
        : input.isPaid ? total : 0
    const paidAmount = roundOrderAmount(Math.max(0, requestedPaidAmount), input.currency)

    if (paidAmount > total) {
        throw new Error('Initial payment cannot exceed the order total')
    }

    const balanceAmount = roundOrderAmount(Math.max(total - paidAmount, 0), input.currency)
    const paymentStatus: OrderPaymentStatus = balanceAmount <= 0
        ? 'paid'
        : paidAmount > 0
            ? 'partial'
            : 'unpaid'
    if (isFinanced && balanceAmount <= 0) {
        throw new Error('A financed order must have a remaining balance')
    }

    const isInstallmentBased = paymentMethod === 'installments' && balanceAmount > 0
    const firstDueDate = isFinanced ? input.firstDueDate?.slice(0, 10) || null : null
    const installmentCount = isInstallmentBased
        ? Math.max(1, Math.trunc(input.installmentCount || 1))
        : paymentMethod === 'loan' && firstDueDate ? 1 : 0
    const installmentFrequency = isFinanced ? (input.installmentFrequency || 'monthly') : null

    if (isInstallmentBased && !firstDueDate) {
        throw new Error('Select the first installment due date')
    }

    return {
        isPaid: paymentStatus === 'paid',
        paymentStatus,
        paidAmount,
        balanceAmount,
        paidAt: paymentStatus === 'paid' ? (input.paidAt || now) : null,
        paymentMethod: paymentMethod as OrderPaymentMethod,
        initialPaymentAmount: isFinanced ? paidAmount : 0,
        linkedLoanId: null,
        isInstallmentBased,
        installmentCount,
        installmentFrequency,
        firstDueDate,
        nextDueDate: firstDueDate
    }
}

function getActiveOrderPayments(rows: PaymentTransaction[]) {
    const reversalAmounts = new Map<string, number>()
    for (const row of rows) {
        if (row.isDeleted || !row.reversalOfTransactionId) continue
        const current = reversalAmounts.get(row.reversalOfTransactionId) || 0
        reversalAmounts.set(row.reversalOfTransactionId, current + Math.abs(Number(row.amount || 0)))
    }

    return rows
        .filter((row) => !row.isDeleted && !row.reversalOfTransactionId && row.amount > 0)
        .map((row) => ({
            ...row,
            amount: roundOrderAmount(
                Math.max(0, Number(row.amount || 0) - (reversalAmounts.get(row.id) || 0)),
                row.currency
            )
        }))
        .filter((row) => row.amount > ORDER_AMOUNT_EPSILON)
        .sort((left, right) =>
            left.paidAt.localeCompare(right.paidAt)
            || left.createdAt.localeCompare(right.createdAt)
            || left.id.localeCompare(right.id)
        )
}

async function listActiveOrderPayments(workspaceId: string, sourceType: 'sales_order' | 'purchase_order', orderId: string) {
    const rows = await db.payment_transactions
        .where('[workspaceId+sourceType+sourceRecordId]')
        .equals([workspaceId, sourceType, orderId])
        .toArray()
    return getActiveOrderPayments(rows)
}

async function appendInitialOrderPaymentTransaction(orderType: OrderType, order: SalesOrder | PurchaseOrder) {
    const sourceType = orderType === 'sales' ? 'sales_order' : 'purchase_order'
    const isFinanced = isOrderFinancingMethod(order.paymentMethod)
    const paymentAmount = isFinanced
        ? roundOrderAmount(Math.max(0, Number(order.initialPaymentAmount || 0)), order.currency)
        : order.paidAmount
    if (paymentAmount <= 0) {
        return
    }

    const activePayments = await listActiveOrderPayments(order.workspaceId, sourceType, order.id)
    if (activePayments.length > 0) {
        return
    }

    const { appendPaymentTransaction } = await import('./payments')
    await appendPaymentTransaction(order.workspaceId, {
        sourceModule: 'orders',
        sourceType,
        sourceRecordId: order.id,
        sourceSubrecordId: null,
        direction: orderType === 'sales' ? 'incoming' : 'outgoing',
        amount: paymentAmount,
        currency: order.currency,
        paymentMethod: (isFinanced ? 'cash' : (order.paymentMethod || 'unknown')) as PaymentTransaction['paymentMethod'],
        paidAt: order.paidAt || order.updatedAt,
        counterpartyName: orderType === 'sales'
            ? (order as SalesOrder).customerName
            : (order as PurchaseOrder).supplierName,
        referenceLabel: order.orderNumber,
        note: order.notes || null,
        metadata: {
            orderStatus: order.status,
            ...(orderType === 'sales' ? { sourceChannel: (order as SalesOrder).sourceChannel || 'manual' } : {}),
            isDownPayment: isFinanced,
            isFinancingInitialPayment: isFinanced
        }
    })
}

function isFullOrderPaymentAttempt(
    payment: PaymentTransaction,
    total: number,
    currency: CurrencyCode,
    installmentId?: string | null
) {
    const amount = roundOrderAmount(Number(payment.amount || 0), currency)
    const targetSubrecordId = installmentId ?? null
    if ((payment.sourceSubrecordId ?? null) !== targetSubrecordId || amount <= 0) {
        return false
    }

    if (Math.abs(amount - total) <= ORDER_AMOUNT_EPSILON) {
        return true
    }

    return currency === 'iqd'
        && Math.abs(amount - Math.round(total)) <= ORDER_AMOUNT_EPSILON
        && Math.abs(amount - total) <= 0.5
}

async function repairStaleFullOrderPaymentAttempts(
    workspaceId: string,
    order: SalesOrder | PurchaseOrder,
    activePayments: PaymentTransaction[],
    input: {
        amount: number
        installmentId?: string | null
    }
) {
    const total = roundOrderAmount(Math.max(0, Number(order.total || 0)), order.currency)
    const amount = roundOrderAmount(Number(input.amount || 0), order.currency)
    if (
        activePayments.length === 0
        || getOrderPaidAmount(order) > ORDER_AMOUNT_EPSILON
        || Math.abs(amount - total) > ORDER_AMOUNT_EPSILON
        || activePayments.some((payment) => !isFullOrderPaymentAttempt(payment, total, order.currency, input.installmentId))
    ) {
        return null
    }

    const exactPayment = activePayments.filter((payment) =>
        Math.abs(roundOrderAmount(Number(payment.amount || 0), order.currency) - total) <= ORDER_AMOUNT_EPSILON
    ).at(-1)
    const retainedPayment = exactPayment ?? activePayments.at(-1)
    if (!retainedPayment) {
        return null
    }

    const now = new Date().toISOString()
    const repairedPayments = activePayments.map((payment) => ({
        ...payment,
        amount: payment.id === retainedPayment.id ? total : payment.amount,
        isDeleted: payment.id !== retainedPayment.id,
        updatedAt: now,
        version: payment.version + 1,
        ...getSyncMetadata(workspaceId, now)
    }))

    await db.payment_transactions.bulkPut(repairedPayments)
    await syncUpsertEntities(
        'payment_transactions',
        repairedPayments as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
        workspaceId
    )

    return repairedPayments.find((payment) => payment.id === retainedPayment.id) ?? null
}

export async function mirrorLinkedOrderPaymentState(loan: Loan) {
    if (loan.source !== 'order' || !loan.orderId || !loan.orderType) {
        return
    }

    const orderTable = loan.orderType === 'sales' ? db.sales_orders : db.purchase_orders
    const tableName: OrderTableName = loan.orderType === 'sales' ? 'sales_orders' : 'purchase_orders'
    const order = await orderTable.get(loan.orderId) as SalesOrder | PurchaseOrder | undefined
    if (!order || order.isDeleted) {
        return
    }

    const initialPaymentAmount = roundOrderAmount(
        Math.max(0, order.initialPaymentAmount ?? Math.max(order.total - loan.principalAmount, 0)),
        order.currency
    )
    const paidAmount = roundOrderAmount(
        Math.min(order.total, initialPaymentAmount + loan.totalPaidAmount),
        order.currency
    )
    const balanceAmount = roundOrderAmount(Math.max(loan.balanceAmount, 0), order.currency)
    const paymentStatus: OrderPaymentStatus = balanceAmount <= 0
        ? 'paid'
        : paidAmount > 0 ? 'partial' : 'unpaid'
    const latestLoanPayment = paymentStatus === 'paid'
        ? (await db.loan_payments.where('loanId').equals(loan.id).and((item) => !item.isDeleted).toArray())
            .sort((left, right) => right.paidAt.localeCompare(left.paidAt))[0]
        : undefined
    const now = new Date().toISOString()
    const updated = {
        ...order,
        linkedLoanId: loan.id,
        initialPaymentAmount,
        isPaid: paymentStatus === 'paid',
        paymentStatus,
        paidAmount,
        balanceAmount,
        paidAt: paymentStatus === 'paid' ? latestLoanPayment?.paidAt || now : null,
        nextDueDate: loan.nextDueDate || null,
        updatedAt: now,
        version: order.version + 1,
        ...getSyncMetadata(order.workspaceId, now)
    } as SalesOrder | PurchaseOrder

    await orderTable.put(updated as SalesOrder & PurchaseOrder)
    await syncUpsertEntities(
        tableName,
        [updated as unknown as Record<string, unknown> & { id: string; version: number }],
        order.workspaceId
    )

    if (loan.orderType === 'sales') {
        const salesOrder = updated as SalesOrder
        await recalculateCustomerAndPartnerSummaries(order.workspaceId, salesOrder.customerId, salesOrder.businessPartnerId)
    } else {
        const purchaseOrder = updated as PurchaseOrder
        await recalculateSupplierAndPartnerSummaries(order.workspaceId, purchaseOrder.supplierId, purchaseOrder.businessPartnerId)
    }
}

async function softDeleteOrderInstallments(orderId: string, workspaceId: string) {
    const installments = await db.order_installments
        .where('orderId')
        .equals(orderId)
        .and((item) => !item.isDeleted)
        .toArray()
    const now = new Date().toISOString()
    const deleted = installments.map((item) => ({
        ...item,
        isDeleted: true,
        updatedAt: now,
        version: item.version + 1,
        ...getSyncMetadata(workspaceId, now)
    }))

    if (deleted.length > 0) {
        await db.order_installments.bulkPut(deleted)
        await Promise.all(deleted.map((item) => syncSoftDelete('order_installments', item.id, workspaceId)))
    }
}

function getPurchaseOrderReceiptSources(order: PurchaseOrder) {
    const itemIdCounts = order.items.reduce((counts, item) => {
        counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
        return counts
    }, new Map<string, number>())

    return order.items.map((item, itemIndex) => {
        const sourceItemId = (itemIdCounts.get(item.id) ?? 0) > 1
            ? `${item.id}:${itemIndex}`
            : item.id
        return {
            sourceItemId,
            sourceLineKey: `${order.id}:${sourceItemId}`
        }
    })
}

async function receiveInventoryForPurchaseOrder(order: PurchaseOrder) {
    const now = new Date().toISOString()
    const changedInventoryRows: Inventory[] = []
    const changedBatches: StockBatch[] = []
    const affectedProductIds = new Set<string>()
    const receiptSources = getPurchaseOrderReceiptSources(order)

    for (const [itemIndex, item] of order.items.entries()) {
        const product = await db.products.get(item.productId)
        if (!product || product.isDeleted) {
            throw new Error(`Product not found: ${item.productName}`)
        }

        const receivedQuantity = item.receivedQuantity ?? getOrderLineInventoryQuantity(item)
        const hasPriceBookProvenance = Boolean(item.priceBookId && item.priceBookItemId)
        const actualUnitCost = roundAmount(
            hasPriceBookProvenance
                ? convertCurrencyAmountWithSnapshot(
                    item.originalUnitPrice,
                    item.originalCurrency,
                    product.currency,
                    order.exchangeRates
                )
                : item.originalUnitPrice,
            product.currency
        )
        const productUnitCost = roundAmount(product.costPrice ?? 0, product.currency)
        const hasDifferentPurchaseCost = shouldCreatePurchaseCostBatch(
            actualUnitCost,
            productUnitCost,
            product.currency
        )
        const batchSalePrice = item.batchSalePrice ?? product.price
        const hasDifferentBatchSalePrice = shouldCreatePurchaseCostBatch(
            batchSalePrice,
            product.price,
            product.currency
        )
        const shouldCreatePurchaseBatch = hasDifferentPurchaseCost
            || (hasPriceBookProvenance && hasDifferentBatchSalePrice)
        const storageId = resolvePurchaseOrderItemStorageId(order, item)
        if (!storageId) {
            throw new Error(`Select a target storage for ${item.productName}`)
        }

        if (!isPositiveQuantity(receivedQuantity)) {
            throw new Error(`Received quantity must be greater than zero for ${item.productName}`)
        }
        if (!Number.isFinite(actualUnitCost) || actualUnitCost < 0) {
            throw new Error(`Purchase cost is invalid for ${item.productName}`)
        }

        const { sourceItemId, sourceLineKey } = receiptSources[itemIndex]
        if (shouldCreatePurchaseBatch) {
            const existingReceiptBatch = await db.stock_batches
                .where('[sourcePurchaseOrderId+sourcePurchaseOrderItemId]')
                .equals([order.id, sourceItemId])
                .first()
            if (existingReceiptBatch) {
                continue
            }
        }

        const currentInventoryQuantity = await getInventoryQuantityForProductStorage(item.productId, storageId)

        const changedInventoryRow = await putInventoryQuantity(
            order.workspaceId,
            item.productId,
            storageId,
            roundQuantity(currentInventoryQuantity + receivedQuantity),
            now
        )
        if (changedInventoryRow) {
            changedInventoryRows.push(changedInventoryRow)
        }

        if (shouldCreatePurchaseBatch) {
            const receiptBatchId = uuidv5(
                sourceLineKey,
                PURCHASE_BATCH_UUID_NAMESPACE
            )
            const receiptBatch = await createStockBatch(order.workspaceId, {
                productId: item.productId,
                storageId,
                batchNumber: item.batchNumber?.trim() || `${order.orderNumber}-${String(itemIndex + 1).padStart(2, '0')}`,
                quantity: receivedQuantity,
                price: batchSalePrice,
                costPrice: actualUnitCost,
                currency: product.currency,
                expiryDate: item.batchExpiryDate ?? null,
                manufacturingDate: item.batchManufacturingDate ?? null,
                notes: `Received from purchase order ${order.orderNumber}.`,
                sourcePurchaseOrderId: order.id,
                sourcePurchaseOrderItemId: sourceItemId
            }, {
                id: receiptBatchId,
                timestamp: now,
                skipRemoteSync: true
            })
            changedBatches.push(receiptBatch)
        }
        affectedProductIds.add(item.productId)
    }

    for (const productId of affectedProductIds) {
        await syncProductStockSnapshot(productId, now)
    }

    return {
        changedInventoryRows,
        changedBatches
    }
}

async function preparePurchaseOrderReceipt(order: PurchaseOrder) {
    await refreshStockBatchesFromSupabase(order.workspaceId)
    await Promise.all([
        hydrateStockBatchesForPurchaseOrder(order.workspaceId, order.id),
        ...order.items.map(async (item) => {
            const storageId = resolvePurchaseOrderItemStorageId(order, item)
            if (!storageId) {
                throw new Error(`Select a target storage for ${item.productName}`)
            }
            await hydrateInventoryProductStoragesFromSupabase(
                order.workspaceId,
                item.productId,
                [storageId]
            )
        })
    ])
}

type PurchaseReceiptResult = Awaited<ReturnType<typeof receiveInventoryForPurchaseOrder>>

async function syncPurchaseReceiptResult(workspaceId: string, result: PurchaseReceiptResult | null) {
    if (!result) {
        return
    }

    await Promise.all([
        syncInventoryRowsBestEffort(result.changedInventoryRows, workspaceId),
        syncStockBatchesBestEffort(result.changedBatches, workspaceId)
    ])
}

export function useSalesOrders(workspaceId: string | undefined, startDate?: string, endDate?: string) {
    const online = useNetworkStatus()

    const orders = useLiveQuery(
        async () => {
            if (!workspaceId) return []

            let query = db.sales_orders.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted)

            if (startDate && endDate) {
                query = query.filter(order => order.createdAt >= startDate && order.createdAt <= endDate)
            } else if (startDate) {
                query = query.filter(order => order.createdAt >= startDate)
            } else if (endDate) {
                query = query.filter(order => order.createdAt <= endDate)
            }

            const rows = await query.toArray()
            return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        },
        [workspaceId, startDate, endDate]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            fetchTableFromSupabase('sales_orders', db.sales_orders, workspaceId)
        }
    }, [online, workspaceId])

    return orders ?? []
}

export function usePurchaseOrders(workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const orders = useLiveQuery(
        async () => {
            if (!workspaceId) return []
            const rows = await db.purchase_orders.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted).toArray()
            return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        },
        [workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            fetchTableFromSupabase('purchase_orders', db.purchase_orders, workspaceId)
        }
    }, [online, workspaceId])

    return orders ?? []
}

export function useSalesOrder(orderId: string | undefined) {
    return useLiveQuery(() => orderId ? db.sales_orders.get(orderId) : undefined, [orderId])
}

export function useSalesOrderReturns(orderId: string | undefined, workspaceId?: string) {
    const online = useNetworkStatus()
    const returns = useLiveQuery<OrderReturn[]>(
        () => orderId
            ? db.order_returns
                .where('orderId')
                .equals(orderId)
                .and((item) => !item.isDeleted && item.status === 'posted')
                .toArray()
                .then((rows) => rows.sort((left, right) => right.returnedAt.localeCompare(left.returnedAt)))
            : Promise.resolve([] as OrderReturn[]),
        [orderId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase('order_returns', db.order_returns, workspaceId, { includeDeleted: true })
            void fetchTableFromSupabase('order_return_items', db.order_return_items, workspaceId, { includeDeleted: true })
        }
    }, [online, workspaceId])

    return returns ?? []
}

export function useSalesOrderReturnItems(orderId: string | undefined, workspaceId?: string) {
    const online = useNetworkStatus()
    const items = useLiveQuery<OrderReturnItem[]>(
        () => orderId
            ? db.order_return_items
                .where('orderId')
                .equals(orderId)
                .and((item) => !item.isDeleted)
                .toArray()
            : Promise.resolve([] as OrderReturnItem[]),
        [orderId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase('order_return_items', db.order_return_items, workspaceId, { includeDeleted: true })
        }
    }, [online, workspaceId])

    return items ?? []
}

/**
 * Return rows are stored independently from the order so they can be audited.
 * Pages that mirror sales orders need this workspace-level view to project the
 * returned quantity onto each order line.
 */
export function useSalesOrderReturnItemsForWorkspace(workspaceId?: string) {
    const online = useNetworkStatus()
    const items = useLiveQuery<OrderReturnItem[]>(
        () => workspaceId
            ? db.order_return_items
                .where('workspaceId')
                .equals(workspaceId)
                .and((item) => !item.isDeleted)
                .toArray()
            : Promise.resolve([] as OrderReturnItem[]),
        [workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase('order_return_items', db.order_return_items, workspaceId, { includeDeleted: true })
        }
    }, [online, workspaceId])

    return items ?? []
}

/** Project immutable return rows onto order line items for sales-history and analytics views. */
export function applySalesOrderReturnQuantities(
    orders: readonly SalesOrder[],
    returnItems: readonly OrderReturnItem[]
): SalesOrder[] {
    const returnedByOrderAndItem = new Map<string, number>()

    for (const returnItem of returnItems) {
        if (returnItem.isDeleted) continue
        const key = `${returnItem.orderId}:${returnItem.orderItemId}`
        const quantity = roundQuantity(Math.max(0, Number(returnItem.quantity || 0)))
        returnedByOrderAndItem.set(key, roundQuantity((returnedByOrderAndItem.get(key) || 0) + quantity))
    }

    return orders.map((order) => {
        const items = order.items.map((item) => {
            const returnedQuantity = returnedByOrderAndItem.get(`${order.id}:${item.id}`)
            if (returnedQuantity === undefined) return item

            return {
                ...item,
                returnedQuantity: Math.min(getOrderLineInventoryQuantity(item), returnedQuantity)
            }
        })

        return { ...order, items }
    })
}

export function usePurchaseOrder(orderId: string | undefined) {
    return useLiveQuery(() => orderId ? db.purchase_orders.get(orderId) : undefined, [orderId])
}

export function useOrderInstallments(orderId: string | undefined, workspaceId?: string) {
    const online = useNetworkStatus()
    const installments = useLiveQuery<OrderInstallment[]>(
        () => orderId
            ? db.order_installments
                .where('orderId')
                .equals(orderId)
                .and((item) => !item.isDeleted)
                .sortBy('installmentNo')
            : Promise.resolve([] as OrderInstallment[]),
        [orderId]
    )
    const installmentWorkspaceId = installments?.[0]?.workspaceId

    useEffect(() => {
        const resolvedWorkspaceId = workspaceId || installmentWorkspaceId
        if (online && resolvedWorkspaceId && shouldUseCloudBusinessData(resolvedWorkspaceId)) {
            void fetchTableFromSupabase('order_installments', db.order_installments, resolvedWorkspaceId)
        }
    }, [installmentWorkspaceId, online, workspaceId])

    return installments ?? []
}

export function useWorkspaceOrderInstallments(workspaceId: string | undefined) {
    const online = useNetworkStatus()
    const installments = useLiveQuery<OrderInstallment[]>(
        () => workspaceId
            ? db.order_installments
                .where('workspaceId')
                .equals(workspaceId)
                .and((item) => !item.isDeleted)
                .toArray()
            : Promise.resolve([] as OrderInstallment[]),
        [workspaceId]
    )

    useEffect(() => {
        if (online && workspaceId && shouldUseCloudBusinessData(workspaceId)) {
            void fetchTableFromSupabase('order_installments', db.order_installments, workspaceId)
        }
    }, [online, workspaceId])

    return installments ?? []
}

export async function rebuildOrderPaymentState(
    orderType: OrderType,
    orderId: string,
    options: { throwOnOrderSyncError?: boolean } = {}
) {
    const orderTable = orderType === 'sales' ? db.sales_orders : db.purchase_orders
    const sourceType = orderType === 'sales' ? 'sales_order' : 'purchase_order'
    const order = await orderTable.get(orderId) as SalesOrder | PurchaseOrder | undefined
    if (!order || order.isDeleted) {
        throw new Error('Order not found')
    }

    const now = new Date().toISOString()
    const activePayments = await listActiveOrderPayments(order.workspaceId, sourceType, order.id)
    const paidAmount = roundOrderAmount(
        activePayments.reduce((sum, payment) => sum + payment.amount, 0),
        order.currency
    )
    const total = roundOrderAmount(Math.max(0, Number(order.total || 0)), order.currency)
    if (paidAmount - total > ORDER_AMOUNT_EPSILON) {
        throw new Error('Order payment total exceeds the order balance')
    }

    const normalizedPaidAmount = paidAmount > total ? total : paidAmount
    const balanceAmount = roundOrderAmount(Math.max(total - normalizedPaidAmount, 0), order.currency)
    const paymentStatus: OrderPaymentStatus = balanceAmount <= 0
        ? 'paid'
        : paidAmount > 0
            ? 'partial'
            : 'unpaid'
    const latestPayment = activePayments.at(-1)
    const installmentRows = await db.order_installments
        .where('orderId')
        .equals(order.id)
        .and((item) => !item.isDeleted)
        .sortBy('installmentNo')
    const allocatablePayments = activePayments
        .filter((payment) => payment.metadata?.isDownPayment !== true)
        .map((payment) => ({
            id: payment.id,
            amount: payment.amount,
            paidAt: payment.paidAt,
            targetInstallmentId: payment.sourceSubrecordId || null
        }))
    const rebuiltInstallments = rebuildOrderInstallmentsFromPayments(
        installmentRows,
        allocatablePayments,
        order.currency,
        now
    ).map((item) => ({
        ...item,
        updatedAt: now,
        version: item.version + 1,
        ...getSyncMetadata(order.workspaceId, now)
    }))
    const nextDueDate = rebuiltInstallments.find((item) => item.balanceAmount > 0)?.dueDate || null
    const updated = {
        ...order,
        isPaid: paymentStatus === 'paid',
        paymentStatus,
        paidAmount: normalizedPaidAmount,
        balanceAmount,
        paidAt: paymentStatus === 'paid' ? latestPayment?.paidAt || now : null,
        paymentMethod: (latestPayment?.paymentMethod as OrderPaymentMethod | undefined) || order.paymentMethod || 'cash',
        nextDueDate,
        updatedAt: now,
        version: order.version + 1,
        ...getSyncMetadata(order.workspaceId, now)
    } as SalesOrder | PurchaseOrder

    await db.transaction('rw', [orderTable, db.order_installments], async () => {
        await orderTable.put(updated as SalesOrder & PurchaseOrder)
        if (rebuiltInstallments.length > 0) {
            await db.order_installments.bulkPut(rebuiltInstallments)
        }
    })

    await Promise.all([
        syncUpsertEntities(
            orderType === 'sales' ? 'sales_orders' : 'purchase_orders',
            [updated as unknown as Record<string, unknown> & { id: string; version: number }],
            order.workspaceId,
            { throwOnNonRetriableError: options.throwOnOrderSyncError }
        ),
        syncUpsertEntities(
            'order_installments',
            rebuiltInstallments as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            order.workspaceId
        )
    ])

    if (orderType === 'sales') {
        const salesOrder = updated as SalesOrder
        await recalculateCustomerAndPartnerSummaries(
            order.workspaceId,
            salesOrder.customerId,
            salesOrder.businessPartnerId
        )
    } else {
        const purchaseOrder = updated as PurchaseOrder
        await recalculateSupplierAndPartnerSummaries(
            order.workspaceId,
            purchaseOrder.supplierId,
            purchaseOrder.businessPartnerId
        )
    }

    return updated
}

export async function recordOrderPayment(
    workspaceId: string,
    input: {
        orderType: OrderType
        orderId: string
        installmentId?: string | null
        amount: number
        paymentMethod: Exclude<OrderPaymentMethod, 'loan' | 'installments'>
        paidAt: string
        note?: string | null
        createdBy?: string | null
    }
) {
    const orderTable = input.orderType === 'sales' ? db.sales_orders : db.purchase_orders
    const sourceType = input.orderType === 'sales' ? 'sales_order' : 'purchase_order'
    const order = await orderTable.get(input.orderId) as SalesOrder | PurchaseOrder | undefined
    if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
        throw new Error('Order not found')
    }
    if (isOrderFinancingMethod(order.paymentMethod) || order.linkedLoanId) {
        throw new Error('financed_order_payments_managed_in_loan_module')
    }
    if (order.isLocked) {
        throw new Error('locked_order_immutable')
    }

    const activePayments = await listActiveOrderPayments(workspaceId, sourceType, order.id)
    const activePaidAmount = roundOrderAmount(
        activePayments.reduce((sum, payment) => sum + payment.amount, 0),
        order.currency
    )
    const total = roundOrderAmount(Math.max(0, Number(order.total || 0)), order.currency)
    const amount = roundOrderAmount(Number(input.amount || 0), order.currency)
    if (activePaidAmount - total > ORDER_AMOUNT_EPSILON) {
        const repairedPayment = await repairStaleFullOrderPaymentAttempts(workspaceId, order, activePayments, {
            amount,
            installmentId: input.installmentId
        })

        if (!repairedPayment) {
            throw new Error('Order payment total exceeds the order balance')
        }

        const updatedOrder = await rebuildOrderPaymentState(input.orderType, order.id)
        return { order: updatedOrder, transaction: repairedPayment }
    }

    const balanceAmount = roundOrderAmount(Math.max(total - activePaidAmount, 0), order.currency)
    if (amount <= 0) {
        throw new Error('Invalid payment amount')
    }
    if (balanceAmount <= ORDER_AMOUNT_EPSILON) {
        const updatedOrder = await rebuildOrderPaymentState(input.orderType, order.id)
        const latestPayment = activePayments.at(-1)
        if (!latestPayment) {
            throw new Error('Payment amount cannot exceed the remaining balance')
        }
        return { order: updatedOrder, transaction: latestPayment }
    }
    if (amount - balanceAmount > ORDER_AMOUNT_EPSILON) {
        throw new Error('Payment amount cannot exceed the remaining balance')
    }

    let installment: OrderInstallment | undefined
    if (input.installmentId) {
        installment = await db.order_installments.get(input.installmentId)
        if (!installment || installment.isDeleted || installment.orderId !== order.id) {
            throw new Error('Order installment not found')
        }
    }

    const { appendPaymentTransaction } = await import('./payments')
    const transaction = await appendPaymentTransaction(workspaceId, {
        sourceModule: 'orders',
        sourceType,
        sourceRecordId: order.id,
        sourceSubrecordId: installment?.id || null,
        direction: input.orderType === 'sales' ? 'incoming' : 'outgoing',
        amount,
        currency: order.currency,
        paymentMethod: input.paymentMethod,
        paidAt: input.paidAt,
        counterpartyName: input.orderType === 'sales'
            ? (order as SalesOrder).customerName
            : (order as PurchaseOrder).supplierName,
        referenceLabel: order.orderNumber,
        note: input.note || null,
        createdBy: input.createdBy || null,
        metadata: {
            orderStatus: order.status,
            orderType: input.orderType,
            installmentNo: installment?.installmentNo || null
        }
    })
    try {
        const updatedOrder = await rebuildOrderPaymentState(input.orderType, order.id, {
            throwOnOrderSyncError: true
        })
        return { order: updatedOrder, transaction }
    } catch (error) {
        try {
            const { reversePaymentTransaction } = await import('./payments')
            await reversePaymentTransaction(workspaceId, transaction.id, {
                createdBy: input.createdBy || null,
                note: 'Automatically reversed because the linked order could not be synced.'
            })
        } catch (reversalError) {
            console.error('[Orders] Failed to reverse payment after order sync failure:', reversalError)
            throw new Error(
                `${error instanceof Error ? error.message : 'The order could not be synced.'} `
                + 'The payment was posted but could not be reversed automatically; reverse it from Payments before retrying.'
            )
        }

        throw error
    }
}

export async function createSalesOrder(
    workspaceId: string,
    data: CreateOrderInput<SalesOrder>,
    createdBy?: string | null
) {
    const now = new Date().toISOString()
    const orderNumber = await generateDocumentNumber('sales_orders', workspaceId)
    const status = data.status || 'draft'
    const counterparty = await normalizeSalesOrderCounterparty(data)
    const paymentState = normalizeOrderPaymentState(data, now)
    const order = buildBaseEntity(workspaceId, {
        ...data,
        ...paymentState,
        ...counterparty,
        orderNumber,
        sourceChannel: data.sourceChannel ?? 'manual',
        marketplaceOrderId: data.marketplaceOrderId ?? null,
        status,
        createdBy: createdBy ?? null
    }) as SalesOrder
    const confirmedAdjustments = normalizeOrderAdjustments(order.orderAdjustments, order.currency)
    if (confirmedAdjustments.length > 0) order.orderAdjustments = confirmedAdjustments
    else delete order.orderAdjustments
    order.nextDueDate = isOrderFinancingMethod(order.paymentMethod) ? order.firstDueDate || null : null

    await assertSalesProductsHaveCosts(order)

    if (status === 'pending' || status === 'completed') {
        if (isOrderFinancingMethod(order.paymentMethod)) {
            throw new Error('Financed orders must be activated from draft')
        }
        if (!order.isPaid) {
            throw new Error('non_financed_order_must_be_paid')
        }
        await assertSalesStockAvailable(order)
    }

    await db.sales_orders.put(order)

    if (status === 'completed') {
        const fulfillment = await deductInventoryForSalesOrder(order)
        order.items = fulfillment.updatedItems
        const now = new Date().toISOString()
        await db.sales_orders.update(order.id, {
            items: fulfillment.updatedItems,
            actualDeliveryDate: now,
            updatedAt: now
        })
    } else if (status === 'pending') {
        await db.sales_orders.update(order.id, {
            reservedAt: order.reservedAt || new Date().toISOString()
        })
    }

    await syncUpsertEntities('sales_orders', [order as unknown as Record<string, unknown> & { id: string; version: number }], workspaceId)
    await recalculateCustomerAndPartnerSummaries(workspaceId, order.customerId, order.businessPartnerId)
    const createdOrder = (await db.sales_orders.get(order.id)) as SalesOrder

    if (!isOrderApprovalRequested(createdOrder)) {
        await appendInitialOrderPaymentTransaction('sales', createdOrder)
    }

    return createdOrder
}

export async function updateSalesOrder(id: string, data: Partial<SalesOrder>) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Sales order not found')
    }

    if (existing.status !== 'draft') {
        throw new Error('Only draft sales orders can be edited')
    }

    const now = new Date().toISOString()
    const activePayments = await listActiveOrderPayments(existing.workspaceId, 'sales_order', existing.id)
    if (activePayments.some((payment) => payment.metadata?.isDownPayment !== true)) {
        throw new Error('Orders with posted installment payments cannot be edited')
    }
    const activePaidAmount = roundOrderAmount(
        activePayments.reduce((sum, payment) => sum + payment.amount, 0),
        data.currency || existing.currency
    )
    const counterparty = await normalizeSalesOrderCounterparty({
        businessPartnerId: data.businessPartnerId ?? existing.businessPartnerId ?? null,
        customerId: data.customerId ?? existing.businessPartnerId ?? existing.customerId,
        customerName: data.customerName ?? existing.customerName
    })
    const paymentState = normalizeOrderPaymentState({
        total: data.total ?? existing.total,
        currency: data.currency ?? existing.currency,
        paidAmount: activePayments.length > 0 ? activePaidAmount : data.paidAmount ?? getOrderPaidAmount(existing),
        initialPaymentAmount: data.initialPaymentAmount ?? existing.initialPaymentAmount ?? 0,
        paymentMethod: (activePayments.at(-1)?.paymentMethod as OrderPaymentMethod | undefined)
            || data.paymentMethod
            || existing.paymentMethod,
        paidAt: activePayments.at(-1)?.paidAt || data.paidAt || existing.paidAt,
        isInstallmentBased: data.isInstallmentBased ?? existing.isInstallmentBased,
        installmentCount: data.installmentCount ?? existing.installmentCount,
        installmentFrequency: data.installmentFrequency ?? existing.installmentFrequency,
        firstDueDate: data.firstDueDate ?? existing.firstDueDate
    }, now)
    const hasOrderAdjustmentsUpdate = Object.prototype.hasOwnProperty.call(data, 'orderAdjustments')
    const orderCurrency = data.currency ?? existing.currency
    const confirmedAdjustments = normalizeOrderAdjustments(
        hasOrderAdjustmentsUpdate ? data.orderAdjustments : existing.orderAdjustments,
        orderCurrency
    )
    const updated: SalesOrder = {
        ...existing,
        ...data,
        ...(confirmedAdjustments.length > 0 ? { orderAdjustments: confirmedAdjustments } : {}),
        ...paymentState,
        ...counterparty,
        linkedLoanId: existing.linkedLoanId || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }
    if (confirmedAdjustments.length === 0) delete updated.orderAdjustments

    updated.nextDueDate = isOrderFinancingMethod(updated.paymentMethod) ? updated.firstDueDate || null : null
    await assertSalesProductsHaveCosts(updated)
    await db.sales_orders.put(updated)
    const orderForSync = hasOrderAdjustmentsUpdate && confirmedAdjustments.length === 0
        ? { ...updated, orderAdjustments: null }
        : updated
    await syncUpsertEntities('sales_orders', [orderForSync as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)

    await Promise.all(
        Array.from(new Set([
            `${existing.customerId}::${existing.businessPartnerId || ''}`,
            `${updated.customerId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [customerId, businessPartnerId] = key.split('::')
            return recalculateCustomerAndPartnerSummaries(
                existing.workspaceId,
                customerId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

async function activateOrderFinancing(orderType: OrderType, order: SalesOrder | PurchaseOrder) {
    if (!isOrderFinancingMethod(order.paymentMethod)) {
        if (!order.isPaid) {
            throw new Error('non_financed_order_must_be_paid')
        }
        return null
    }
    if (order.linkedLoanId) {
        return order.linkedLoanId
    }
    if (order.balanceAmount <= 0) {
        throw new Error('A financed order must have a remaining balance')
    }

    if (shouldUseCloudBusinessData(order.workspaceId)) {
        if (!isOnline(order.workspaceId)) {
            throw new Error('financed_order_activation_requires_online')
        }

        await syncUpsertEntities(
            orderType === 'sales' ? 'sales_orders' : 'purchase_orders',
            [order as unknown as Record<string, unknown> & { id: string; version: number }],
            order.workspaceId
        )
        const targetStatus = orderType === 'sales' ? 'pending' : 'ordered'
        const { data, error } = await runMutation('orders.activateFinancing', () =>
            supabase.rpc('activate_financed_order', {
                p_order_type: orderType,
                p_order_id: order.id,
                p_target_status: targetStatus
            })
        )
        if (error) throw error
        const loanId = typeof data?.loan_id === 'string' ? data.loan_id : null
        if (!loanId) {
            throw new Error('Linked loan was not created')
        }
        await Promise.all([
            fetchTableFromSupabase('loans', db.loans, order.workspaceId),
            fetchTableFromSupabase('loan_installments', db.loan_installments, order.workspaceId)
        ])
        return loanId
    }

    const partner = orderType === 'sales'
        ? await resolveCustomerBusinessPartner((order as SalesOrder).customerId, order.businessPartnerId)
        : await resolveSupplierBusinessPartner((order as PurchaseOrder).supplierId, order.businessPartnerId)
    if (!partner) {
        throw new Error('Business partner not found')
    }
    const { createLoanFromOrder } = await import('./hooks')
    const result = await createLoanFromOrder(order.workspaceId, {
        orderId: order.id,
        orderType,
        loanCategory: order.paymentMethod === 'loan' ? 'simple' : 'standard',
        direction: orderType === 'sales' ? 'lent' : 'borrowed',
        linkedPartyType: 'business_partner',
        linkedPartyId: partner.id,
        linkedPartyName: partner.name,
        borrowerName: partner.name,
        borrowerPhone: partner.phone || '',
        borrowerAddress: [partner.address, partner.city, partner.country].filter(Boolean).join(', '),
        borrowerNationalId: '',
        principalAmount: order.balanceAmount,
        settlementCurrency: order.currency,
        exchangeRateSnapshot: order.exchangeRates || null,
        installmentCount: order.paymentMethod === 'installments'
            ? Math.max(1, order.installmentCount)
            : 1,
        installmentFrequency: order.installmentFrequency || 'monthly',
        firstDueDate: order.firstDueDate || null,
        notes: `Financing for ${orderType} order ${order.orderNumber}`,
        createdBy: order.createdBy || undefined
    })
    return result.loan.id
}

export async function updateSalesOrderStatus(id: string, status: SalesOrderStatus) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Sales order not found')
    }

    if (isOrderApprovalRequested(existing)) {
        throw new Error('order_request_requires_approval')
    }

    if (existing.status === 'completed' && status !== 'completed') {
        throw new Error('Completed sales orders are immutable')
    }
    if (status === 'pending' && existing.status !== 'draft') {
        throw new Error('invalid_order_transition')
    }
    if (status === 'completed' && existing.status !== 'pending') {
        throw new Error('invalid_order_transition')
    }

    let linkedLoanId = existing.linkedLoanId || null
    if (status === 'pending') {
        await assertSalesProductsHaveCosts(existing)
        await assertSalesStockAvailable(existing, existing.id)
        linkedLoanId = await activateOrderFinancing('sales', existing)
    }
    if (status === 'cancelled' && existing.linkedLoanId) {
        if ((existing.initialPaymentAmount || 0) > 0) {
            throw new Error('financed_order_has_payment_history')
        }
        const { cancelOrderLinkedLoan } = await import('./hooks')
        await cancelOrderLinkedLoan(existing.linkedLoanId)
    }

    const now = new Date().toISOString()
    const counterparty = await normalizeSalesOrderCounterparty({
        businessPartnerId: existing.businessPartnerId ?? null,
        customerId: existing.businessPartnerId ?? existing.customerId,
        customerName: existing.customerName
    })
    const updated: SalesOrder = {
        ...existing,
        ...counterparty,
        status,
        linkedLoanId,
        updatedAt: now,
        version: existing.version + 1,
        reservedAt: status === 'pending' ? (existing.reservedAt || now) : existing.reservedAt,
        actualDeliveryDate: status === 'completed' ? now : existing.actualDeliveryDate,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    if (status === 'completed') {
        await assertSalesProductsHaveCosts(updated)
        await assertSalesStockAvailable(updated, existing.id)
        const fulfillment = await deductInventoryForSalesOrder(updated)
        updated.items = fulfillment.updatedItems
    }

    await db.sales_orders.put(updated)

    await syncUpsertEntities('sales_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await Promise.all(
        Array.from(new Set([
            `${existing.customerId}::${existing.businessPartnerId || ''}`,
            `${updated.customerId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [customerId, businessPartnerId] = key.split('::')
            return recalculateCustomerAndPartnerSummaries(
                existing.workspaceId,
                customerId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

export async function approveSalesOrderRequest(id: string, reviewedBy?: string | null) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Sales order not found')
    }
    if (!isOrderApprovalRequested(existing)) {
        throw new Error('Order request is not pending approval')
    }
    if (existing.status !== 'draft') {
        throw new Error('Only draft sales order requests can be approved')
    }

    const updated: SalesOrder = {
        ...existing,
        ...buildApprovalReviewPatch(existing, reviewedBy)
    }

    await db.sales_orders.put(updated)
    await syncUpsertEntities('sales_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await appendInitialOrderPaymentTransaction('sales', updated)
    return updated
}

export async function setSalesOrderPaymentStatus(
    id: string,
    input: {
        isPaid: boolean
        paymentMethod?: SalesOrder['paymentMethod']
        paidAt?: string | null
    }
) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Sales order not found')
    }
    if (isOrderFinancingMethod(existing.paymentMethod) || existing.linkedLoanId) {
        throw new Error('financed_order_payments_managed_in_loan_module')
    }
    if (!input.isPaid && existing.status !== 'draft') {
        throw new Error('non_financed_order_must_be_paid')
    }

    const now = new Date().toISOString()
    const counterparty = await normalizeSalesOrderCounterparty({
        businessPartnerId: existing.businessPartnerId ?? null,
        customerId: existing.businessPartnerId ?? existing.customerId,
        customerName: existing.customerName
    })
    const updated: SalesOrder = {
        ...existing,
        ...counterparty,
        isPaid: input.isPaid,
        paymentStatus: input.isPaid ? 'paid' : 'unpaid',
        paidAmount: input.isPaid ? existing.total : 0,
        balanceAmount: input.isPaid ? 0 : existing.total,
        paymentMethod: input.paymentMethod || existing.paymentMethod || 'cash',
        initialPaymentAmount: 0,
        paidAt: input.isPaid ? (input.paidAt || now) : null,
        nextDueDate: input.isPaid ? null : existing.firstDueDate || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    if (existing.isLocked) {
        throw new Error('locked_order_immutable')
    }

    await db.sales_orders.put(updated)
    await syncUpsertEntities('sales_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await Promise.all(
        Array.from(new Set([
            `${existing.customerId}::${existing.businessPartnerId || ''}`,
            `${updated.customerId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [customerId, businessPartnerId] = key.split('::')
            return recalculateCustomerAndPartnerSummaries(
                existing.workspaceId,
                customerId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

export async function lockSalesOrder(id: string) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Sales order not found')
    }

    if (!existing.isPaid) {
        throw new Error('only_paid_orders_can_be_locked')
    }

    const now = new Date().toISOString()
    const updated: SalesOrder = {
        ...existing,
        isLocked: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.sales_orders.put(updated)
    await syncUpsertEntities('sales_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    return updated
}

export type SalesOrderReturnLineInput = {
    orderItemId: string
    quantity: number
}

export type ReturnSalesOrderInput = {
    orderId: string
    items: SalesOrderReturnLineInput[]
    reason: string
    returnedBy?: string | null
    actorRole?: string | null
}

type PreparedSalesOrderReturnLine = {
    item: SalesOrderItem
    quantity: number
    previouslyReturnedQuantity: number
    refundAmount: number
    unitRefundAmount: number
}

type RestoredOrderReturnLine = PreparedSalesOrderReturnLine & {
    restoredStorageId: string | null
    restoredBatchAllocations: StockBatchAllocation[]
}

function getSalesOrderOriginalTotal(order: SalesOrder) {
    const returnedAmount = roundAmount(Math.max(0, Number(order.returnedAmount || 0)), order.currency)
    return roundAmount(
        Math.max(0, Number(order.originalTotalAmount ?? Number(order.total || 0) + returnedAmount)),
        order.currency
    )
}

function getLoanReturnInstallmentStatus(dueDate: string | null, paidAmount: number, balanceAmount: number, today: string) {
    if (balanceAmount <= ORDER_AMOUNT_EPSILON) return 'paid' as const
    if (paidAmount > ORDER_AMOUNT_EPSILON) return 'partial' as const
    return dueDate && dueDate.slice(0, 10) < today ? 'overdue' as const : 'unpaid' as const
}

function getLoanReturnStatus(nextDueDate: string | null, balanceAmount: number, today: string) {
    if (balanceAmount <= ORDER_AMOUNT_EPSILON) return 'completed' as const
    return nextDueDate && nextDueDate.slice(0, 10) < today ? 'overdue' as const : 'active' as const
}

function getPaymentTransactionRemainingAmount(transaction: PaymentTransaction, rows: PaymentTransaction[]) {
    const reversalTotal = rows
        .filter((row) => !row.isDeleted && row.reversalOfTransactionId === transaction.id)
        .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0)
    return roundOrderAmount(Math.max(0, Number(transaction.amount || 0) - reversalTotal), transaction.currency)
}

async function appendOrderReturnPaymentReversal(input: {
    transaction: PaymentTransaction
    amount: number
    returnId: string
    reason: string
    returnedBy?: string | null
}) {
    if (input.amount <= ORDER_AMOUNT_EPSILON) return null

    return appendPaymentTransaction(input.transaction.workspaceId, {
        sourceModule: input.transaction.sourceModule,
        sourceType: input.transaction.sourceType,
        sourceRecordId: input.transaction.sourceRecordId,
        sourceSubrecordId: input.transaction.sourceSubrecordId ?? null,
        direction: input.transaction.direction,
        amount: -Math.abs(input.amount),
        currency: input.transaction.currency,
        paymentMethod: input.transaction.paymentMethod,
        paidAt: new Date().toISOString(),
        counterpartyName: input.transaction.counterpartyName || null,
        referenceLabel: input.transaction.referenceLabel || null,
        note: `Order return ${input.returnId}: ${input.reason}`,
        createdBy: input.returnedBy || null,
        reversalOfTransactionId: input.transaction.id,
        metadata: {
            ...(input.transaction.metadata || {}),
            orderReturnId: input.returnId,
            returnReason: input.reason,
            partialReversal: true
        }
    })
}

async function restoreInventoryForSalesOrderReturn(
    order: SalesOrder,
    lines: PreparedSalesOrderReturnLine[],
    timestamp: string
): Promise<RestoredOrderReturnLine[]> {
    const plans = await Promise.all(lines.map(async (line) => {
        const restoredStorageId = await resolveReturnStorageId({
            workspaceId: order.workspaceId,
            productId: line.item.productId,
            saleStorageId: line.item.storageId || order.sourceStorageId || null
        })
        if (!restoredStorageId) {
            throw new Error(`No active storage available for returned item ${line.item.productName}`)
        }

        const afterPreviousReturn = splitStockBatchAllocationsForReturn(
            line.item.batchAllocations || [],
            line.previouslyReturnedQuantity
        ).remainingAllocations
        const allocationSplit = splitStockBatchAllocationsForReturn(afterPreviousReturn, line.quantity)

        return {
            ...line,
            restoredStorageId,
            restoredAllocations: allocationSplit.restoredAllocations,
            restoredBatchAllocations: [] as StockBatchAllocation[]
        }
    }))

    const applied: typeof plans = []
    try {
        for (const plan of plans) {
            await adjustInventoryQuantity({
                workspaceId: order.workspaceId,
                productId: plan.item.productId,
                storageId: plan.restoredStorageId,
                quantityDelta: plan.quantity,
                timestamp
            })
            if (plan.restoredAllocations.length > 0) {
                plan.restoredBatchAllocations = await restoreStockBatchAllocations(
                    order.workspaceId,
                    plan.item.productId,
                    plan.restoredStorageId,
                    plan.restoredAllocations,
                    { timestamp }
                )
            }
            applied.push(plan)
        }
    } catch (error) {
        for (const plan of [...applied].reverse()) {
            try {
                if (plan.restoredBatchAllocations.length > 0) {
                    await commitStockBatchAllocations(
                        order.workspaceId,
                        plan.item.productId,
                        plan.restoredStorageId,
                        plan.restoredBatchAllocations,
                        { timestamp }
                    )
                }
                await adjustInventoryQuantity({
                    workspaceId: order.workspaceId,
                    productId: plan.item.productId,
                    storageId: plan.restoredStorageId,
                    quantityDelta: -plan.quantity,
                    timestamp
                })
            } catch (rollbackError) {
                console.error('[Orders] Failed to roll back order-return inventory:', rollbackError)
            }
        }
        throw error
    }

    return plans.map((plan) => ({
        item: plan.item,
        quantity: plan.quantity,
        previouslyReturnedQuantity: plan.previouslyReturnedQuantity,
        refundAmount: plan.refundAmount,
        unitRefundAmount: plan.unitRefundAmount,
        restoredStorageId: plan.restoredStorageId,
        restoredBatchAllocations: plan.restoredBatchAllocations
    }))
}

async function applySalesOrderReturnToFinancing(input: {
    order: SalesOrder
    returnId: string
    returnAmount: number
    reason: string
    returnedBy?: string | null
    timestamp: string
}) {
    const loan = input.order.linkedLoanId ? await db.loans.get(input.order.linkedLoanId) : null
    if (!loan || loan.isDeleted || loan.source !== 'order' || loan.orderId !== input.order.id || loan.orderType !== 'sales') {
        throw new Error('The linked order loan was not found')
    }

    const [installments, loanPayments, paymentTransactions] = await Promise.all([
        db.loan_installments.where('loanId').equals(loan.id).and((item) => !item.isDeleted).sortBy('installmentNo'),
        db.loan_payments.where('loanId').equals(loan.id).and((item) => !item.isDeleted).toArray(),
        db.payment_transactions.where('workspaceId').equals(input.order.workspaceId).toArray()
    ])

    const originalLoanBalance = roundAmount(Math.max(0, Number(loan.balanceAmount || 0)), loan.settlementCurrency)
    let remainingRefund = roundAmount(Math.max(0, input.returnAmount - originalLoanBalance), loan.settlementCurrency)
    const updatedLoanPayments: Array<typeof loanPayments[number]> = []
    const loanPaymentRefunds: Array<{ transaction: PaymentTransaction; amount: number }> = []
    let unmappedLoanPaymentRefund = 0
    const paymentsByNewestFirst = loanPayments
        .slice()
        .sort((left, right) => right.paidAt.localeCompare(left.paidAt) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))

    for (const payment of paymentsByNewestFirst) {
        if (remainingRefund <= ORDER_AMOUNT_EPSILON) break
        const applied = roundAmount(Math.min(Math.max(0, payment.amount), remainingRefund), loan.settlementCurrency)
        if (applied <= ORDER_AMOUNT_EPSILON) continue

        const nextAmount = roundAmount(Math.max(0, payment.amount - applied), loan.settlementCurrency)
        const updatedPayment = {
            ...payment,
            amount: nextAmount,
            isDeleted: nextAmount <= ORDER_AMOUNT_EPSILON,
            updatedAt: input.timestamp,
            version: payment.version + 1,
            ...getSyncMetadata(input.order.workspaceId, input.timestamp)
        }
        updatedLoanPayments.push(updatedPayment)
        remainingRefund = roundAmount(Math.max(0, remainingRefund - applied), loan.settlementCurrency)

        const sourceTransaction = paymentTransactions
            .filter((transaction) => !transaction.isDeleted && !transaction.reversalOfTransactionId)
            .find((transaction) => transaction.metadata?.loanPaymentId === payment.id
                || (transaction.sourceSubrecordId === payment.id && transaction.sourceType !== 'loan_installment'))
        if (sourceTransaction) {
            loanPaymentRefunds.push({ transaction: sourceTransaction, amount: applied })
        } else {
            unmappedLoanPaymentRefund = roundAmount(unmappedLoanPaymentRefund + applied, input.order.currency)
        }
    }

    const activeUpdatedPayments = loanPayments.map((payment) =>
        updatedLoanPayments.find((candidate) => candidate.id === payment.id) || payment
    )
    const newLoanPaidAmount = roundAmount(
        activeUpdatedPayments
            .filter((payment) => !payment.isDeleted)
            .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0),
        loan.settlementCurrency
    )
    const initialPaymentRefund = roundAmount(Math.max(0, remainingRefund), input.order.currency)
    const nextInitialPayment = roundAmount(
        Math.max(0, Number(input.order.initialPaymentAmount || 0) - initialPaymentRefund),
        input.order.currency
    )
    const nextPrincipal = roundAmount(
        Math.max(0, Number(loan.principalAmount || 0) - input.returnAmount),
        loan.settlementCurrency
    )
    const nextBalance = roundAmount(Math.max(0, nextPrincipal - newLoanPaidAmount), loan.settlementCurrency)

    const paidByInstallment = new Map<string, number>()
    let paymentToAllocate = newLoanPaidAmount
    for (const installment of installments) {
        const paid = roundAmount(Math.min(Math.max(0, Number(installment.plannedAmount || 0)), paymentToAllocate), loan.settlementCurrency)
        paidByInstallment.set(installment.id, paid)
        paymentToAllocate = roundAmount(Math.max(0, paymentToAllocate - paid), loan.settlementCurrency)
    }

    const originalRemaining = installments.reduce((sum, installment) => {
        const paid = paidByInstallment.get(installment.id) || 0
        return sum + Math.max(0, Number(installment.plannedAmount || 0) - paid)
    }, 0)
    let remainingBalanceToAllocate = nextBalance
    const today = input.timestamp.slice(0, 10)
    const updatedInstallments = installments.map((installment, index) => {
        const paidAmount = paidByInstallment.get(installment.id) || 0
        const existingRemaining = Math.max(0, Number(installment.plannedAmount || 0) - paidAmount)
        const isLast = index === installments.length - 1
        const balanceAmount = roundAmount(
            isLast
                ? remainingBalanceToAllocate
                : originalRemaining <= ORDER_AMOUNT_EPSILON
                    ? 0
                    : Math.min(remainingBalanceToAllocate, nextBalance * (existingRemaining / originalRemaining)),
            loan.settlementCurrency
        )
        remainingBalanceToAllocate = roundAmount(Math.max(0, remainingBalanceToAllocate - balanceAmount), loan.settlementCurrency)
        const plannedAmount = roundAmount(paidAmount + balanceAmount, loan.settlementCurrency)
        return {
            ...installment,
            plannedAmount,
            paidAmount,
            balanceAmount,
            status: getLoanReturnInstallmentStatus(installment.dueDate, paidAmount, balanceAmount, today),
            paidAt: balanceAmount <= ORDER_AMOUNT_EPSILON && paidAmount > ORDER_AMOUNT_EPSILON ? installment.paidAt || input.timestamp : null,
            updatedAt: input.timestamp,
            version: installment.version + 1,
            ...getSyncMetadata(input.order.workspaceId, input.timestamp)
        }
    })
    const nextDueDate = updatedInstallments.find((installment) => installment.balanceAmount > ORDER_AMOUNT_EPSILON)?.dueDate || null
    const updatedLoan = {
        ...loan,
        principalAmount: nextPrincipal,
        totalPaidAmount: newLoanPaidAmount,
        balanceAmount: nextBalance,
        nextDueDate,
        status: getLoanReturnStatus(nextDueDate, nextBalance, today),
        updatedAt: input.timestamp,
        version: loan.version + 1,
        ...getSyncMetadata(input.order.workspaceId, input.timestamp)
    }

    await db.transaction('rw', [db.loans, db.loan_installments, db.loan_payments], async () => {
        await db.loans.put(updatedLoan)
        if (updatedInstallments.length > 0) await db.loan_installments.bulkPut(updatedInstallments)
        if (updatedLoanPayments.length > 0) await db.loan_payments.bulkPut(updatedLoanPayments)
    })

    await Promise.all(loanPaymentRefunds.map(({ transaction, amount }) =>
        appendOrderReturnPaymentReversal({
            transaction,
            amount,
            returnId: input.returnId,
            reason: input.reason,
            returnedBy: input.returnedBy
        })
    ))
    if (unmappedLoanPaymentRefund > ORDER_AMOUNT_EPSILON) {
        await appendPaymentTransaction(input.order.workspaceId, {
            sourceModule: 'orders',
            sourceType: 'order_return',
            sourceRecordId: input.returnId,
            direction: 'outgoing',
            amount: -unmappedLoanPaymentRefund,
            currency: input.order.currency,
            paymentMethod: 'cash',
            paidAt: input.timestamp,
            counterpartyName: input.order.customerName,
            referenceLabel: input.order.orderNumber,
            note: `Order return ${input.returnId}: loan repayment refund`,
            createdBy: input.returnedBy || null,
            metadata: {
                orderId: input.order.id,
                orderReturnId: input.returnId,
                loanRepaymentRefund: true
            }
        })
    }
    if (initialPaymentRefund > ORDER_AMOUNT_EPSILON) {
        const initialPayments = paymentTransactions
            .filter((transaction) => !transaction.isDeleted
                && transaction.sourceType === 'sales_order'
                && transaction.sourceRecordId === input.order.id
                && transaction.metadata?.isFinancingInitialPayment === true
            )
            .sort((left, right) => right.paidAt.localeCompare(left.paidAt) || right.createdAt.localeCompare(left.createdAt))
        let remainingInitialRefund = initialPaymentRefund
        for (const transaction of initialPayments) {
            if (remainingInitialRefund <= ORDER_AMOUNT_EPSILON) break
            const available = getPaymentTransactionRemainingAmount(transaction, paymentTransactions)
            const applied = roundAmount(Math.min(available, remainingInitialRefund), input.order.currency)
            if (applied <= ORDER_AMOUNT_EPSILON) continue
            await appendOrderReturnPaymentReversal({
                transaction,
                amount: applied,
                returnId: input.returnId,
                reason: input.reason,
                returnedBy: input.returnedBy
            })
            remainingInitialRefund = roundAmount(Math.max(0, remainingInitialRefund - applied), input.order.currency)
        }
        if (remainingInitialRefund > ORDER_AMOUNT_EPSILON) {
            await appendPaymentTransaction(input.order.workspaceId, {
                sourceModule: 'orders',
                sourceType: 'order_return',
                sourceRecordId: input.returnId,
                direction: 'outgoing',
                amount: -remainingInitialRefund,
                currency: input.order.currency,
                paymentMethod: 'cash',
                paidAt: input.timestamp,
                counterpartyName: input.order.customerName,
                referenceLabel: input.order.orderNumber,
                note: `Order return ${input.returnId}: financing down payment refund`,
                createdBy: input.returnedBy || null,
                metadata: {
                    orderId: input.order.id,
                    orderReturnId: input.returnId,
                    financingInitialPaymentRefund: true
                }
            })
        }
    }

    await Promise.all([
        syncUpsertEntities('loans', [updatedLoan], input.order.workspaceId),
        syncUpsertEntities('loan_installments', updatedInstallments, input.order.workspaceId),
        syncUpsertEntities(
            'loan_payments',
            updatedLoanPayments as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            input.order.workspaceId
        )
    ])

    return { loan: updatedLoan, initialPaymentAmount: nextInitialPayment }
}

export async function returnSalesOrder(input: ReturnSalesOrderInput) {
    if (input.actorRole !== 'admin') {
        throw new Error('Only admins can return completed sales orders')
    }

    const order = await db.sales_orders.get(input.orderId)
    if (!order || order.isDeleted) {
        throw new Error('Sales order not found')
    }
    if (order.status !== 'completed') {
        throw new Error('Only completed sales orders can be returned')
    }

    const reason = input.reason.trim()
    if (!reason) {
        throw new Error('Select a return reason')
    }
    if (input.items.length === 0) {
        throw new Error('Select at least one item to return')
    }

    const quantitiesByItemId = new Map<string, number>()
    for (const line of input.items) {
        const quantity = roundQuantity(Number(line.quantity || 0))
        if (!isPositiveQuantity(quantity)) {
            throw new Error('Return quantity must be greater than zero')
        }
        if (quantitiesByItemId.has(line.orderItemId)) {
            throw new Error('Return items must be unique')
        }
        quantitiesByItemId.set(line.orderItemId, quantity)
    }

    const [existingReturnItems, existingReturns] = await Promise.all([
        db.order_return_items.where('orderId').equals(order.id).and((item) => !item.isDeleted).toArray(),
        db.order_returns.where('orderId').equals(order.id).and((item) => !item.isDeleted && item.status === 'posted').toArray()
    ])
    const returnedQuantityByItemId = new Map<string, number>()
    for (const returnItem of existingReturnItems) {
        returnedQuantityByItemId.set(
            returnItem.orderItemId,
            roundQuantity((returnedQuantityByItemId.get(returnItem.orderItemId) || 0) + returnItem.quantity)
        )
    }
    const returnedAmount = roundAmount(
        existingReturns.reduce((sum, row) => sum + Math.max(0, Number(row.refundAmount || 0)), 0),
        order.currency
    )
    const originalTotal = getSalesOrderOriginalTotal(order)
    const itemValueBase = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.lineTotal || 0)), 0)
    const fallbackItemValueBase = itemValueBase > ORDER_AMOUNT_EPSILON ? itemValueBase : order.items.length

    const preparedLines: PreparedSalesOrderReturnLine[] = []
    for (const [orderItemId, quantity] of quantitiesByItemId) {
        const item = order.items.find((candidate) => candidate.id === orderItemId)
        if (!item) {
            throw new Error('Order item not found')
        }
        const totalQuantity = getOrderLineInventoryQuantity(item)
        const previouslyReturnedQuantity = returnedQuantityByItemId.get(orderItemId) || 0
        if (quantity - (totalQuantity - previouslyReturnedQuantity) > ORDER_AMOUNT_EPSILON) {
            throw new Error(`Return quantity exceeds the remaining quantity for ${item.productName}`)
        }

        const itemShare = itemValueBase > ORDER_AMOUNT_EPSILON
            ? Math.max(0, Number(item.lineTotal || 0)) / itemValueBase
            : 1 / fallbackItemValueBase
        const cumulativePrevious = originalTotal * itemShare * (previouslyReturnedQuantity / totalQuantity)
        const cumulativeCurrent = originalTotal * itemShare * ((previouslyReturnedQuantity + quantity) / totalQuantity)
        const refundAmount = roundAmount(Math.max(0, cumulativeCurrent - cumulativePrevious), order.currency)
        preparedLines.push({
            item,
            quantity,
            previouslyReturnedQuantity,
            refundAmount,
            unitRefundAmount: roundAmount(refundAmount / quantity, order.currency)
        })
    }

    let returnAmount = roundAmount(preparedLines.reduce((sum, line) => sum + line.refundAmount, 0), order.currency)
    const willBeFullyReturned = order.items.every((item) => {
        const newlyReturned = quantitiesByItemId.get(item.id) || 0
        return (returnedQuantityByItemId.get(item.id) || 0) + newlyReturned >= getOrderLineInventoryQuantity(item) - ORDER_AMOUNT_EPSILON
    })
    if (willBeFullyReturned && preparedLines.length > 0) {
        // The persisted order value is authoritative if legacy data and ledger rows disagree.
        const expectedReturnAmount = roundAmount(Math.max(0, Number(order.total || 0)), order.currency)
        const fullReturnDifference = roundAmount(expectedReturnAmount - returnAmount, order.currency)
        if (Math.abs(fullReturnDifference) > ORDER_AMOUNT_EPSILON) {
            const last = preparedLines[preparedLines.length - 1]
            last.refundAmount = roundAmount(Math.max(0, last.refundAmount + fullReturnDifference), order.currency)
            last.unitRefundAmount = roundAmount(last.refundAmount / last.quantity, order.currency)
            returnAmount = roundAmount(returnAmount + fullReturnDifference, order.currency)
        }
    }
    if (returnAmount <= ORDER_AMOUNT_EPSILON) {
        throw new Error('The selected items do not have a return value')
    }
    if (returnAmount - Number(order.total || 0) > ORDER_AMOUNT_EPSILON) {
        throw new Error('Return amount exceeds the remaining order total')
    }

    const returnId = generateId()
    const timestamp = new Date().toISOString()
    const isFinanced = isOrderFinancingMethod(order.paymentMethod) || !!order.linkedLoanId
    const standardPaymentRows = !isFinanced
        ? await db.payment_transactions
            .where('[workspaceId+sourceType+sourceRecordId]')
            .equals([order.workspaceId, 'sales_order', order.id])
            .toArray()
        : []
    if (!isFinanced) {
        const activePaymentAmount = roundAmount(
            getActiveOrderPayments(standardPaymentRows).reduce((sum, payment) => sum + payment.amount, 0),
            order.currency
        )
        if (activePaymentAmount + ORDER_AMOUNT_EPSILON < returnAmount) {
            throw new Error('The order does not have enough posted payments to reverse this return')
        }
    }

    const restoredLines = await restoreInventoryForSalesOrderReturn(order, preparedLines, timestamp)
    const financingResult = isFinanced
        ? await applySalesOrderReturnToFinancing({
            order,
            returnId,
            returnAmount,
            reason,
            returnedBy: input.returnedBy,
            timestamp
        })
        : null

    const newReturnedAmount = roundAmount(returnedAmount + returnAmount, order.currency)
    const nextTotal = roundAmount(Math.max(0, Number(order.total || 0) - returnAmount), order.currency)
    const nextReturnStatus = willBeFullyReturned ? 'full' as const : 'partial' as const
    const updatedOrder: SalesOrder = {
        ...order,
        items: order.items.map((item) => ({
            ...item,
            returnedQuantity: Math.min(
                getOrderLineInventoryQuantity(item),
                roundQuantity((returnedQuantityByItemId.get(item.id) || 0) + (quantitiesByItemId.get(item.id) || 0))
            )
        })),
        originalTotalAmount: order.originalTotalAmount ?? originalTotal,
        returnedAmount: newReturnedAmount,
        returnStatus: nextReturnStatus,
        returnedAt: timestamp,
        returnedBy: input.returnedBy || null,
        total: nextTotal,
        subtotal: roundAmount(Math.max(0, Number(order.subtotal || 0) * (nextTotal / Math.max(Number(order.total || 0), 1))), order.currency),
        discount: roundAmount(Math.max(0, Number(order.discount || 0) * (nextTotal / Math.max(Number(order.total || 0), 1))), order.currency),
        tax: roundAmount(Math.max(0, Number(order.tax || 0) * (nextTotal / Math.max(Number(order.total || 0), 1))), order.currency),
        initialPaymentAmount: financingResult?.initialPaymentAmount ?? order.initialPaymentAmount,
        isPaid: financingResult ? financingResult.loan.balanceAmount <= ORDER_AMOUNT_EPSILON : order.isPaid,
        paymentStatus: financingResult
            ? financingResult.loan.balanceAmount <= ORDER_AMOUNT_EPSILON ? 'paid' : (financingResult.loan.totalPaidAmount + (financingResult.initialPaymentAmount || 0) > 0 ? 'partial' : 'unpaid')
            : order.paymentStatus,
        paidAmount: financingResult
            ? roundAmount((financingResult.initialPaymentAmount || 0) + financingResult.loan.totalPaidAmount, order.currency)
            : order.paidAmount,
        balanceAmount: financingResult ? financingResult.loan.balanceAmount : order.balanceAmount,
        paidAt: financingResult?.loan.balanceAmount && financingResult.loan.balanceAmount > ORDER_AMOUNT_EPSILON ? null : order.paidAt,
        nextDueDate: financingResult?.loan.nextDueDate ?? order.nextDueDate,
        updatedAt: timestamp,
        version: order.version + 1,
        ...getSyncMetadata(order.workspaceId, timestamp)
    }
    let finalOrder = updatedOrder
    const orderReturn: OrderReturn = {
        id: returnId,
        workspaceId: order.workspaceId,
        orderId: order.id,
        reason,
        status: 'posted',
        refundAmount: returnAmount,
        returnedBy: input.returnedBy || null,
        returnedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        isDeleted: false,
        ...getSyncMetadata(order.workspaceId, timestamp)
    }
    const orderReturnItems: OrderReturnItem[] = restoredLines.map((line) => ({
        id: generateId(),
        workspaceId: order.workspaceId,
        returnId,
        orderId: order.id,
        orderItemId: line.item.id,
        quantity: line.quantity,
        unitRefundAmount: line.unitRefundAmount,
        refundAmount: line.refundAmount,
        restoredStorageId: line.restoredStorageId,
        restoredBatchAllocations: line.restoredBatchAllocations,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        isDeleted: false,
        ...getSyncMetadata(order.workspaceId, timestamp)
    }))

    await db.transaction('rw', [db.sales_orders, db.order_returns, db.order_return_items], async () => {
        await db.sales_orders.put(updatedOrder)
        await db.order_returns.put(orderReturn)
        await db.order_return_items.bulkPut(orderReturnItems)
    })

    if (!isFinanced) {
        const activePayments = getActiveOrderPayments(standardPaymentRows).reverse()
        let remainingPaymentReversal = returnAmount
        for (const payment of activePayments) {
            if (remainingPaymentReversal <= ORDER_AMOUNT_EPSILON) break
            const original = standardPaymentRows.find((row) => row.id === payment.id)
            if (!original) continue
            const applied = roundAmount(Math.min(payment.amount, remainingPaymentReversal), order.currency)
            await appendOrderReturnPaymentReversal({
                transaction: original,
                amount: applied,
                returnId,
                reason,
                returnedBy: input.returnedBy
            })
            remainingPaymentReversal = roundAmount(Math.max(0, remainingPaymentReversal - applied), order.currency)
        }
        if (remainingPaymentReversal > ORDER_AMOUNT_EPSILON) {
            throw new Error('The order does not have enough posted payments to reverse this return')
        }
        finalOrder = await rebuildOrderPaymentState('sales', order.id) as SalesOrder
    } else {
        await recalculateCustomerAndPartnerSummaries(order.workspaceId, order.customerId, order.businessPartnerId)
    }

    await Promise.all([
        syncUpsertEntities(
            'sales_orders',
            [finalOrder] as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            order.workspaceId
        ),
        syncUpsertEntities(
            'order_returns',
            [orderReturn] as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            order.workspaceId
        ),
        syncUpsertEntities(
            'order_return_items',
            orderReturnItems as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            order.workspaceId
        )
    ])

    return { order: finalOrder, return: orderReturn, items: orderReturnItems }
}

export async function deleteSalesOrder(id: string) {
    const existing = await db.sales_orders.get(id)
    if (!existing || existing.isDeleted) {
        return
    }

    if (existing.status === 'completed' || existing.status === 'pending') {
        throw new Error('Active sales orders cannot be deleted')
    }
    if (getOrderPaidAmount(existing) > 0) {
        throw new Error('Orders with posted payments cannot be deleted')
    }

    const now = new Date().toISOString()
    await db.sales_orders.put({
        ...existing,
        isDeleted: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    })
    await syncSoftDelete('sales_orders', id, existing.workspaceId)
    await softDeleteOrderInstallments(id, existing.workspaceId)
    await recalculateCustomerAndPartnerSummaries(existing.workspaceId, existing.customerId, existing.businessPartnerId)
}

export async function createPurchaseOrder(
    workspaceId: string,
    data: CreateOrderInput<PurchaseOrder>,
    createdBy?: string | null
) {
    const now = new Date().toISOString()
    const orderNumber = await generateDocumentNumber('purchase_orders', workspaceId)
    const status = data.status || 'draft'
    const counterparty = await normalizePurchaseOrderCounterparty(data)
    const paymentState = normalizeOrderPaymentState(data, now)
    const order = buildBaseEntity(workspaceId, {
        ...data,
        ...paymentState,
        ...counterparty,
        orderNumber,
        status,
        createdBy: createdBy ?? null
    }) as PurchaseOrder
    const confirmedAdjustments = normalizeOrderAdjustments(order.orderAdjustments, order.currency)
    if (confirmedAdjustments.length > 0) order.orderAdjustments = confirmedAdjustments
    else delete order.orderAdjustments
    order.nextDueDate = isOrderFinancingMethod(order.paymentMethod) ? order.firstDueDate || null : null

    if (status !== 'draft' && isOrderFinancingMethod(order.paymentMethod)) {
        throw new Error('Financed orders must be activated from draft')
    }
    if (status !== 'draft' && !order.isPaid) {
        throw new Error('non_financed_order_must_be_paid')
    }

    let receiptResult: PurchaseReceiptResult | null = null
    if (status === 'received' || status === 'completed') {
        await preparePurchaseOrderReceipt(order)
    }
    await db.transaction(
        'rw',
        [db.purchase_orders, db.products, db.inventory, db.stock_batches, db.storages],
        async () => {
            await db.purchase_orders.put(order)
            if (status === 'received' || status === 'completed') {
                receiptResult = await receiveInventoryForPurchaseOrder(order)
            }
        }
    )

    await syncUpsertEntities('purchase_orders', [order as unknown as Record<string, unknown> & { id: string; version: number }], workspaceId)
    await syncPurchaseReceiptResult(workspaceId, receiptResult)
    await recalculateSupplierAndPartnerSummaries(workspaceId, order.supplierId, order.businessPartnerId)
    const createdOrder = (await db.purchase_orders.get(order.id)) as PurchaseOrder

    if (!isOrderApprovalRequested(createdOrder)) {
        await appendInitialOrderPaymentTransaction('purchase', createdOrder)
    }

    return createdOrder
}

export async function updatePurchaseOrder(id: string, data: Partial<PurchaseOrder>) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
    }

    if (existing.status !== 'draft') {
        throw new Error('Only draft purchase orders can be edited')
    }

    const now = new Date().toISOString()
    const activePayments = await listActiveOrderPayments(existing.workspaceId, 'purchase_order', existing.id)
    if (activePayments.some((payment) => payment.metadata?.isDownPayment !== true)) {
        throw new Error('Orders with posted installment payments cannot be edited')
    }
    const activePaidAmount = roundOrderAmount(
        activePayments.reduce((sum, payment) => sum + payment.amount, 0),
        data.currency || existing.currency
    )
    const counterparty = await normalizePurchaseOrderCounterparty({
        businessPartnerId: data.businessPartnerId ?? existing.businessPartnerId ?? null,
        supplierId: data.supplierId ?? existing.businessPartnerId ?? existing.supplierId,
        supplierName: data.supplierName ?? existing.supplierName
    })
    const paymentState = normalizeOrderPaymentState({
        total: data.total ?? existing.total,
        currency: data.currency ?? existing.currency,
        paidAmount: activePayments.length > 0 ? activePaidAmount : data.paidAmount ?? getOrderPaidAmount(existing),
        initialPaymentAmount: data.initialPaymentAmount ?? existing.initialPaymentAmount ?? 0,
        paymentMethod: (activePayments.at(-1)?.paymentMethod as OrderPaymentMethod | undefined)
            || data.paymentMethod
            || existing.paymentMethod,
        paidAt: activePayments.at(-1)?.paidAt || data.paidAt || existing.paidAt,
        isInstallmentBased: data.isInstallmentBased ?? existing.isInstallmentBased,
        installmentCount: data.installmentCount ?? existing.installmentCount,
        installmentFrequency: data.installmentFrequency ?? existing.installmentFrequency,
        firstDueDate: data.firstDueDate ?? existing.firstDueDate
    }, now)
    const hasOrderAdjustmentsUpdate = Object.prototype.hasOwnProperty.call(data, 'orderAdjustments')
    const orderCurrency = data.currency ?? existing.currency
    const confirmedAdjustments = normalizeOrderAdjustments(
        hasOrderAdjustmentsUpdate ? data.orderAdjustments : existing.orderAdjustments,
        orderCurrency
    )
    const updated: PurchaseOrder = {
        ...existing,
        ...data,
        ...(confirmedAdjustments.length > 0 ? { orderAdjustments: confirmedAdjustments } : {}),
        ...paymentState,
        ...counterparty,
        linkedLoanId: existing.linkedLoanId || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }
    if (confirmedAdjustments.length === 0) delete updated.orderAdjustments

    updated.nextDueDate = isOrderFinancingMethod(updated.paymentMethod) ? updated.firstDueDate || null : null
    await db.purchase_orders.put(updated)
    const orderForSync = hasOrderAdjustmentsUpdate && confirmedAdjustments.length === 0
        ? { ...updated, orderAdjustments: null }
        : updated
    await syncUpsertEntities('purchase_orders', [orderForSync as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)

    await Promise.all(
        Array.from(new Set([
            `${existing.supplierId}::${existing.businessPartnerId || ''}`,
            `${updated.supplierId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [supplierId, businessPartnerId] = key.split('::')
            return recalculateSupplierAndPartnerSummaries(
                existing.workspaceId,
                supplierId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

export async function updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
    }

    if (isOrderApprovalRequested(existing)) {
        throw new Error('order_request_requires_approval')
    }

    if ((existing.status === 'received' || existing.status === 'completed') && status === 'cancelled') {
        throw new Error('Received purchase orders cannot be cancelled')
    }

    if (existing.status === 'completed' && status !== 'completed') {
        throw new Error('Completed purchase orders are immutable')
    }
    if (status === 'ordered' && existing.status !== 'draft') {
        throw new Error('invalid_order_transition')
    }
    if (status === 'received' && existing.status !== 'ordered') {
        throw new Error('invalid_order_transition')
    }
    if (status === 'completed' && existing.status !== 'received') {
        throw new Error('invalid_order_transition')
    }

    let linkedLoanId = existing.linkedLoanId || null
    if (status === 'ordered') {
        linkedLoanId = await activateOrderFinancing('purchase', existing)
    }
    if (status === 'cancelled' && existing.linkedLoanId) {
        if ((existing.initialPaymentAmount || 0) > 0) {
            throw new Error('financed_order_has_payment_history')
        }
        const { cancelOrderLinkedLoan } = await import('./hooks')
        await cancelOrderLinkedLoan(existing.linkedLoanId)
    }

    const now = new Date().toISOString()
    const counterparty = await normalizePurchaseOrderCounterparty({
        businessPartnerId: existing.businessPartnerId ?? null,
        supplierId: existing.businessPartnerId ?? existing.supplierId,
        supplierName: existing.supplierName
    })
    const updated: PurchaseOrder = {
        ...existing,
        ...counterparty,
        status,
        linkedLoanId,
        updatedAt: now,
        version: existing.version + 1,
        actualDeliveryDate: status === 'received' || status === 'completed' ? (existing.actualDeliveryDate || now) : existing.actualDeliveryDate,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    let receiptResult: PurchaseReceiptResult | null = null
    if ((status === 'received' || status === 'completed') && existing.status !== 'received' && existing.status !== 'completed') {
        await preparePurchaseOrderReceipt(updated)
    }
    await db.transaction(
        'rw',
        [db.purchase_orders, db.products, db.inventory, db.stock_batches, db.storages],
        async () => {
            if ((status === 'received' || status === 'completed') && existing.status !== 'received' && existing.status !== 'completed') {
                receiptResult = await receiveInventoryForPurchaseOrder(updated)
            }
            await db.purchase_orders.put(updated)
        }
    )

    await syncUpsertEntities('purchase_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await syncPurchaseReceiptResult(existing.workspaceId, receiptResult)
    await Promise.all(
        Array.from(new Set([
            `${existing.supplierId}::${existing.businessPartnerId || ''}`,
            `${updated.supplierId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [supplierId, businessPartnerId] = key.split('::')
            return recalculateSupplierAndPartnerSummaries(
                existing.workspaceId,
                supplierId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

export async function approvePurchaseOrderRequest(id: string, reviewedBy?: string | null) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
    }
    if (!isOrderApprovalRequested(existing)) {
        throw new Error('Order request is not pending approval')
    }
    if (existing.status !== 'draft') {
        throw new Error('Only draft purchase order requests can be approved')
    }

    const updated: PurchaseOrder = {
        ...existing,
        ...buildApprovalReviewPatch(existing, reviewedBy)
    }

    await db.purchase_orders.put(updated)
    await syncUpsertEntities('purchase_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await appendInitialOrderPaymentTransaction('purchase', updated)
    return updated
}

export async function setPurchaseOrderPaymentStatus(
    id: string,
    input: {
        isPaid: boolean
        paymentMethod?: PurchaseOrder['paymentMethod']
        paidAt?: string | null
    }
) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
    }
    if (isOrderFinancingMethod(existing.paymentMethod) || existing.linkedLoanId) {
        throw new Error('financed_order_payments_managed_in_loan_module')
    }
    if (!input.isPaid && existing.status !== 'draft') {
        throw new Error('non_financed_order_must_be_paid')
    }

    const now = new Date().toISOString()
    const counterparty = await normalizePurchaseOrderCounterparty({
        businessPartnerId: existing.businessPartnerId ?? null,
        supplierId: existing.businessPartnerId ?? existing.supplierId,
        supplierName: existing.supplierName
    })
    const updated: PurchaseOrder = {
        ...existing,
        ...counterparty,
        isPaid: input.isPaid,
        paymentStatus: input.isPaid ? 'paid' : 'unpaid',
        paidAmount: input.isPaid ? existing.total : 0,
        balanceAmount: input.isPaid ? 0 : existing.total,
        paymentMethod: input.paymentMethod || existing.paymentMethod || 'cash',
        initialPaymentAmount: 0,
        paidAt: input.isPaid ? (input.paidAt || now) : null,
        nextDueDate: input.isPaid ? null : existing.firstDueDate || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    if (existing.isLocked) {
        throw new Error('locked_order_immutable')
    }

    await db.purchase_orders.put(updated)
    await syncUpsertEntities('purchase_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    await Promise.all(
        Array.from(new Set([
            `${existing.supplierId}::${existing.businessPartnerId || ''}`,
            `${updated.supplierId}::${updated.businessPartnerId || ''}`
        ])).map((key) => {
            const [supplierId, businessPartnerId] = key.split('::')
            return recalculateSupplierAndPartnerSummaries(
                existing.workspaceId,
                supplierId || null,
                businessPartnerId || null
            )
        })
    )
    return updated
}

export async function lockPurchaseOrder(id: string) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
    }

    if (!existing.isPaid) {
        throw new Error('only_paid_orders_can_be_locked')
    }

    const now = new Date().toISOString()
    const updated: PurchaseOrder = {
        ...existing,
        isLocked: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.purchase_orders.put(updated)
    await syncUpsertEntities('purchase_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    return updated
}

export async function deletePurchaseOrder(id: string) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        return
    }

    if (existing.status === 'received' || existing.status === 'completed' || existing.status === 'ordered') {
        throw new Error('Active purchase orders cannot be deleted')
    }
    if (getOrderPaidAmount(existing) > 0) {
        throw new Error('Orders with posted payments cannot be deleted')
    }

    const now = new Date().toISOString()
    await db.purchase_orders.put({
        ...existing,
        isDeleted: true,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    })
    await syncSoftDelete('purchase_orders', id, existing.workspaceId)
    await softDeleteOrderInstallments(id, existing.workspaceId)
    await recalculateSupplierAndPartnerSummaries(existing.workspaceId, existing.supplierId, existing.businessPartnerId)
}
