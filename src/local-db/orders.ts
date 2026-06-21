import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { v5 as uuidv5 } from 'uuid'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { getTravelSaleCost } from '@/lib/travelAgency'
import { convertCurrencyAmountWithSnapshot } from '@/lib/orderCurrency'
import { isOnline } from '@/lib/network'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import { generateId } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { supabase } from '@/auth/supabase'

import { db } from './database'
import {
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
    getInventoryQuantityForProductStorage,
    hydrateInventoryProductStoragesFromSupabase,
    putInventoryQuantity,
    syncInventoryRowsBestEffort,
    syncProductStockSnapshot
} from './inventory'
import { addToOfflineMutations, fetchTableFromSupabase } from './hooks'
import {
    calculateStockBatchUnitCost,
    commitStockBatchAllocations,
    createStockBatch,
    getStockBatchSalePlans,
    hydrateStockBatchesForPurchaseOrder,
    refreshStockBatchesFromSupabase,
    shouldCreatePurchaseCostBatch,
    syncStockBatchesBestEffort
} from './stockBatches'
import type {
    Customer,
    CurrencyCode,
    InstallmentFrequency,
    Inventory,
    Loan,
    OrderInstallment,
    OrderPaymentMethod,
    OrderPaymentStatus,
    OrderType,
    PaymentTransaction,
    PurchaseOrder,
    PurchaseOrderStatus,
    SalesOrder,
    SalesOrderStatus,
    StockBatch,
    Supplier,
    TravelAgencySale
} from './models'

export function isOrderFinancingMethod(method?: OrderPaymentMethod | null): method is 'loan' | 'installments' {
    return method === 'loan' || method === 'installments'
}

type SimpleEntityTableName = 'customers' | 'suppliers'
type OrderTableName = 'sales_orders' | 'purchase_orders'
type OrderInstallmentTableName = 'order_installments'
type SyncableTableName = SimpleEntityTableName | OrderTableName | OrderInstallmentTableName | 'products'

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

type ProductLike = {
    id: string
    workspaceId: string
    quantity: number
    costPrice: number
    currency: CurrencyCode
    updatedAt: string
    syncStatus: 'pending' | 'synced' | 'conflict'
    lastSyncedAt: string | null
    version: number
    isDeleted: boolean
    storageName?: string
}

function shouldUseCloudBusinessData(workspaceId?: string | null) {
    return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

function roundAmount(amount: number, currency: CurrencyCode) {
    if (currency === 'iqd') {
        return Math.round(amount)
    }

    return Math.round(amount * 100) / 100
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

async function syncUpsertEntities(tableName: SyncableTableName, entities: Array<{ id: string; version: number } & Record<string, unknown>>, workspaceId: string) {
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

    return {
        ...data,
        id: generateId(),
        workspaceId,
        createdAt: now,
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
            if (storageId) {
                const key = buildInventoryReservationKey(item.productId, storageId)
                reservedByStorage.set(key, (reservedByStorage.get(key) || 0) + item.quantity)
                continue
            }

            reservedWithoutStorage.set(item.productId, (reservedWithoutStorage.get(item.productId) || 0) + item.quantity)
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

        const storageId = resolveSalesOrderItemStorageId(order, item)
        if (!storageId) {
            throw new Error(`Select a source storage for ${item.productName}`)
        }

        const storageQuantity = await getInventoryQuantityForProductStorage(item.productId, storageId)
        const storageReserved = reservedByStorage.get(buildInventoryReservationKey(item.productId, storageId)) || 0
        const globalReserved = reservedWithoutStorage.get(item.productId) || 0
        const available = storageQuantity - storageReserved - globalReserved
        if (available < item.quantity) {
            throw new Error(`Insufficient stock for ${item.productName}`)
        }
    }
}

async function deductInventoryForSalesOrder(order: SalesOrder) {
    const now = new Date().toISOString()
    const updatedProducts: ProductLike[] = []
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
        quantity: item.quantity
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
                const changedInventoryRow = await putInventoryQuantity(
                    order.workspaceId,
                    item.productId,
                    storageId,
                    currentInventoryQuantity - item.quantity,
                    now
                )
                const updatedProduct = await syncProductStockSnapshot(item.productId, now)

                if (!updatedProduct) {
                    throw new Error(`Product not found: ${item.productName}`)
                }

                if (changedInventoryRow) {
                    changedInventoryRows.push(changedInventoryRow)
                }

                updatedProducts.push(updatedProduct)
                updatedItems[itemIndex] = {
                    ...item,
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
        updatedProducts: Array.from(
            new Map(updatedProducts.map((product) => [product.id, product])).values()
        ),
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
    const reversedIds = new Set(
        rows
            .filter((row) => !row.isDeleted && !!row.reversalOfTransactionId)
            .map((row) => row.reversalOfTransactionId as string)
    )

    return rows
        .filter((row) =>
            !row.isDeleted
            && !row.reversalOfTransactionId
            && !reversedIds.has(row.id)
            && row.amount > 0
        )
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

        const receivedQuantity = item.receivedQuantity ?? item.quantity
        const actualUnitCost = roundAmount(item.originalUnitPrice, product.currency)
        const productUnitCost = roundAmount(product.costPrice, product.currency)
        const hasDifferentPurchaseCost = shouldCreatePurchaseCostBatch(
            actualUnitCost,
            productUnitCost,
            product.currency
        )
        const storageId = resolvePurchaseOrderItemStorageId(order, item)
        if (!storageId) {
            throw new Error(`Select a target storage for ${item.productName}`)
        }

        const isDynamic = product.unit === 'm²' || product.unit === 'Kg'
        if ((!isDynamic && !Number.isInteger(receivedQuantity)) || receivedQuantity <= 0) {
            throw new Error(`Received quantity must be greater than zero for ${item.productName}`)
        }
        if (!Number.isFinite(actualUnitCost) || actualUnitCost < 0) {
            throw new Error(`Purchase cost is invalid for ${item.productName}`)
        }

        const { sourceItemId, sourceLineKey } = receiptSources[itemIndex]
        if (hasDifferentPurchaseCost) {
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
            currentInventoryQuantity + receivedQuantity,
            now
        )
        if (changedInventoryRow) {
            changedInventoryRows.push(changedInventoryRow)
        }

        if (hasDifferentPurchaseCost) {
            const receiptBatchId = uuidv5(
                sourceLineKey,
                PURCHASE_BATCH_UUID_NAMESPACE
            )
            const receiptBatch = await createStockBatch(order.workspaceId, {
                productId: item.productId,
                storageId,
                batchNumber: item.batchNumber?.trim() || `${order.orderNumber}-${String(itemIndex + 1).padStart(2, '0')}`,
                quantity: receivedQuantity,
                price: item.batchSalePrice ?? product.price,
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

    const updatedProducts: ProductLike[] = []
    for (const productId of affectedProductIds) {
        const inventoryUpdatedProduct = await syncProductStockSnapshot(productId, now)
        if (!inventoryUpdatedProduct) {
            continue
        }

        updatedProducts.push(inventoryUpdatedProduct)
    }

    return {
        updatedProducts,
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
        syncStockBatchesBestEffort(result.changedBatches, workspaceId),
        syncUpsertEntities(
            'products',
            result.updatedProducts as unknown as Array<Record<string, unknown> & { id: string; version: number }>,
            workspaceId
        )
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

export async function rebuildOrderPaymentState(orderType: OrderType, orderId: string) {
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
    if (paidAmount > order.total) {
        throw new Error('Order payment total exceeds the order balance')
    }

    const balanceAmount = roundOrderAmount(Math.max(order.total - paidAmount, 0), order.currency)
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
        paidAmount,
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
            order.workspaceId
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

    const balanceAmount = getOrderBalanceAmount(order)
    const amount = roundOrderAmount(Number(input.amount || 0), order.currency)
    if (amount <= 0) {
        throw new Error('Invalid payment amount')
    }
    if (amount > balanceAmount) {
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
    const updatedOrder = await rebuildOrderPaymentState(input.orderType, order.id)
    return { order: updatedOrder, transaction }
}

export async function createSalesOrder(
    workspaceId: string,
    data: Omit<SalesOrder, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'>,
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
    order.nextDueDate = isOrderFinancingMethod(order.paymentMethod) ? order.firstDueDate || null : null

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

    let updatedProducts: ProductLike[] = []
    if (status === 'completed') {
        const fulfillment = await deductInventoryForSalesOrder(order)
        updatedProducts = fulfillment.updatedProducts
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
    if (updatedProducts.length > 0) {
        await syncUpsertEntities('products', updatedProducts as unknown as Array<Record<string, unknown> & { id: string; version: number }>, workspaceId)
    }
    await recalculateCustomerAndPartnerSummaries(workspaceId, order.customerId, order.businessPartnerId)
    const createdOrder = (await db.sales_orders.get(order.id)) as SalesOrder

    if (createdOrder.paidAmount > 0 && !isOrderFinancingMethod(createdOrder.paymentMethod)) {
        const { appendPaymentTransaction } = await import('./payments')
        await appendPaymentTransaction(workspaceId, {
            sourceModule: 'orders',
            sourceType: 'sales_order',
            sourceRecordId: createdOrder.id,
            sourceSubrecordId: null,
            direction: 'incoming',
            amount: createdOrder.paidAmount,
            currency: createdOrder.currency,
            paymentMethod: createdOrder.paymentMethod || 'unknown',
            paidAt: createdOrder.paidAt || createdOrder.updatedAt,
            counterpartyName: createdOrder.customerName,
            referenceLabel: createdOrder.orderNumber,
            note: createdOrder.notes || null,
            metadata: {
                orderStatus: createdOrder.status,
                sourceChannel: createdOrder.sourceChannel || 'manual',
                isDownPayment: false
            }
        })
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
    const updated: SalesOrder = {
        ...existing,
        ...data,
        ...paymentState,
        ...counterparty,
        linkedLoanId: existing.linkedLoanId || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    updated.nextDueDate = isOrderFinancingMethod(updated.paymentMethod) ? updated.firstDueDate || null : null
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
            : order.firstDueDate ? 1 : 0,
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

    let updatedProducts: ProductLike[] = []
    if (status === 'completed') {
        await assertSalesStockAvailable(updated, existing.id)
        const fulfillment = await deductInventoryForSalesOrder(updated)
        updatedProducts = fulfillment.updatedProducts
        updated.items = fulfillment.updatedItems
    }

    await db.sales_orders.put(updated)

    await syncUpsertEntities('sales_orders', [updated as unknown as Record<string, unknown> & { id: string; version: number }], existing.workspaceId)
    if (updatedProducts.length > 0) {
        await syncUpsertEntities('products', updatedProducts as unknown as Array<Record<string, unknown> & { id: string; version: number }>, existing.workspaceId)
    }
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
    data: Omit<PurchaseOrder, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'orderNumber'>,
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

    if (createdOrder.paidAmount > 0 && !isOrderFinancingMethod(createdOrder.paymentMethod)) {
        const { appendPaymentTransaction } = await import('./payments')
        await appendPaymentTransaction(workspaceId, {
            sourceModule: 'orders',
            sourceType: 'purchase_order',
            sourceRecordId: createdOrder.id,
            sourceSubrecordId: null,
            direction: 'outgoing',
            amount: createdOrder.paidAmount,
            currency: createdOrder.currency,
            paymentMethod: createdOrder.paymentMethod || 'unknown',
            paidAt: createdOrder.paidAt || createdOrder.updatedAt,
            counterpartyName: createdOrder.supplierName,
            referenceLabel: createdOrder.orderNumber,
            note: createdOrder.notes || null,
            metadata: {
                orderStatus: createdOrder.status,
                isDownPayment: false
            }
        })
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
    const updated: PurchaseOrder = {
        ...existing,
        ...data,
        ...paymentState,
        ...counterparty,
        linkedLoanId: existing.linkedLoanId || null,
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    updated.nextDueDate = isOrderFinancingMethod(updated.paymentMethod) ? updated.firstDueDate || null : null
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

export async function updatePurchaseOrderStatus(id: string, status: PurchaseOrderStatus) {
    const existing = await db.purchase_orders.get(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Purchase order not found')
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
