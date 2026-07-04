import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'
import type { PurchaseOrder, SalesOrder } from './models'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000201'
const PRODUCT_ID = '00000000-0000-4000-8000-000000000202'

type PurchaseOrderCreateInput = Omit<
    PurchaseOrder,
    'id'
    | 'workspaceId'
    | 'createdAt'
    | 'updatedAt'
    | 'syncStatus'
    | 'lastSyncedAt'
    | 'version'
    | 'isDeleted'
    | 'orderNumber'
>

type SalesOrderCreateInput = Omit<
    SalesOrder,
    'id'
    | 'workspaceId'
    | 'createdAt'
    | 'updatedAt'
    | 'syncStatus'
    | 'lastSyncedAt'
    | 'version'
    | 'isDeleted'
    | 'orderNumber'
>

let createBusinessPartner: typeof import('./businessPartners').createBusinessPartner
let createSalesOrder: typeof import('./orders').createSalesOrder
let createPurchaseOrder: typeof import('./orders').createPurchaseOrder
let updateSalesOrderStatus: typeof import('./orders').updateSalesOrderStatus
let updatePurchaseOrderStatus: typeof import('./orders').updatePurchaseOrderStatus
let recordOrderPayment: typeof import('./orders').recordOrderPayment
let createProduct: typeof import('./hooks').createProduct
let createStorage: typeof import('./hooks').createStorage
let recordLoanPayment: typeof import('./hooks').recordLoanPayment
let buildPaymentObligations: typeof import('./payments').buildPaymentObligations
let reversePaymentTransaction: typeof import('./payments').reversePaymentTransaction

function installBrowserStorage() {
    const rows = new Map<string, string>()
    const storage = {
        get length() {
            return rows.size
        },
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => rows.set(key, value),
        removeItem: (key: string) => rows.delete(key),
        clear: () => rows.clear(),
        key: (index: number) => Array.from(rows.keys())[index] ?? null
    }

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: storage,
            sessionStorage: storage,
            location: { origin: 'http://localhost', hash: '', pathname: '/' },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            visibilityState: 'visible',
            dir: 'ltr',
            documentElement: { lang: 'en', dir: 'ltr' },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
}

async function createSupplier(payableCreditLimit: number | null) {
    return createBusinessPartner(WORKSPACE_ID, {
        name: `Supplier ${payableCreditLimit ?? 'unlimited'}`,
        phone: '07500000201',
        defaultCurrency: 'usd',
        creditLimit: 0,
        receivableCreditLimit: null,
        payableCreditLimit,
        role: 'supplier'
    })
}

async function createCustomer() {
    return createBusinessPartner(WORKSPACE_ID, {
        name: 'Order Customer',
        phone: '07500000202',
        defaultCurrency: 'iqd',
        creditLimit: 0,
        receivableCreditLimit: null,
        payableCreditLimit: null,
        role: 'customer'
    })
}

async function createStockedSalesProduct(total = 15000) {
    const storage = await createStorage(WORKSPACE_ID, { name: 'Order Loan Storage' })
    const product = await createProduct(WORKSPACE_ID, {
        sku: 'SO-LOAN-001',
        name: 'Order Loan Product',
        description: 'Product for order loan tests',
        categoryId: null,
        category: null,
        storageId: storage.id,
        storageName: storage.name,
        price: total,
        costPrice: Math.max(1, total / 2),
        quantity: 5,
        minStockLevel: 0,
        unit: 'pcs',
        currency: 'iqd',
        barcode: '',
        barcodes: [],
        imageUrl: '',
        canBeReturned: true,
        returnRules: '',
        createdBy: null
    })

    return { storage, product }
}

function salesOrderWithStaleRoundedBalance(customerId: string): SalesOrder {
    const now = '2026-06-28T12:00:00.000Z'
    return {
        id: crypto.randomUUID(),
        workspaceId: WORKSPACE_ID,
        orderNumber: 'SO-ROUNDING-001',
        businessPartnerId: customerId,
        customerId,
        customerName: 'Order Customer',
        sourceStorageId: null,
        items: [{
            id: crypto.randomUUID(),
            productId: PRODUCT_ID,
            productName: 'Fractional IQD Product',
            productSku: 'IQD-001',
            quantity: 25.5,
            lineTotal: 688.5,
            originalCurrency: 'iqd',
            originalUnitPrice: 27,
            convertedUnitPrice: 27,
            settlementCurrency: 'iqd',
            costPrice: 10,
            convertedCostPrice: 10
        }],
        subtotal: 688.5,
        discount: 0,
        tax: 0,
        total: 688.5,
        currency: 'iqd',
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        exchangeRates: null,
        status: 'completed',
        expectedDeliveryDate: null,
        actualDeliveryDate: now,
        isPaid: false,
        paymentStatus: 'unpaid',
        paidAmount: 0,
        balanceAmount: 689,
        paidAt: null,
        paymentMethod: 'cash',
        initialPaymentAmount: 0,
        linkedLoanId: null,
        isInstallmentBased: false,
        installmentCount: 0,
        installmentFrequency: null,
        firstDueDate: null,
        nextDueDate: null,
        reservedAt: null,
        shippingAddress: '',
        notes: '',
        isLocked: false,
        sourceChannel: 'manual',
        marketplaceOrderId: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        lastSyncedAt: now,
        version: 1,
        isDeleted: false
    }
}

function salesOrderInput(
    customerId: string,
    product: { id: string; name: string; sku: string; costPrice: number },
    storageId: string,
    options: {
        method: SalesOrder['paymentMethod']
        total?: number
        initialPayment?: number
        firstDueDate?: string | null
    }
): SalesOrderCreateInput {
    const total = options.total ?? 15000
    const initialPayment = options.initialPayment ?? 0
    const financed = options.method === 'loan' || options.method === 'installments'

    return {
        businessPartnerId: customerId,
        customerId,
        customerName: 'Order Customer',
        sourceStorageId: storageId,
        items: [{
            id: crypto.randomUUID(),
            productId: product.id,
            storageId,
            productName: product.name,
            productSku: product.sku,
            quantity: 1,
            lineTotal: total,
            originalCurrency: 'iqd',
            originalUnitPrice: total,
            convertedUnitPrice: total,
            settlementCurrency: 'iqd',
            costPrice: product.costPrice,
            convertedCostPrice: product.costPrice,
            reservedQuantity: 0,
            fulfilledQuantity: 0,
            batchAllocations: null
        }],
        subtotal: total,
        discount: 0,
        tax: 0,
        total,
        currency: 'iqd',
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        exchangeRates: null,
        status: 'draft',
        approvalStatus: null,
        approvalRequestedBy: null,
        approvalRequestedAt: null,
        approvalReviewedBy: null,
        approvalReviewedAt: null,
        expectedDeliveryDate: null,
        actualDeliveryDate: null,
        isPaid: false,
        paymentStatus: initialPayment > 0 ? 'partial' : 'unpaid',
        paidAmount: initialPayment,
        balanceAmount: total - initialPayment,
        paidAt: null,
        paymentMethod: options.method,
        initialPaymentAmount: financed ? initialPayment : 0,
        linkedLoanId: null,
        isInstallmentBased: options.method === 'installments',
        installmentCount: options.method === 'installments' ? 2 : 0,
        installmentFrequency: financed ? 'monthly' : null,
        firstDueDate: financed ? options.firstDueDate ?? null : null,
        nextDueDate: financed ? options.firstDueDate ?? null : null,
        reservedAt: null,
        shippingAddress: '',
        notes: 'Order loan payment projection test',
        isLocked: false,
        sourceChannel: 'manual',
        marketplaceOrderId: null,
        createdBy: null
    }
}

function purchaseOrderInput(
    supplierId: string,
    options: {
        method: PurchaseOrder['paymentMethod']
        total?: number
        initialPayment?: number
        firstDueDate?: string | null
        installmentCount?: number
    }
): PurchaseOrderCreateInput {
    const total = options.total ?? 100
    const initialPayment = options.initialPayment ?? 0
    const financed = options.method === 'loan' || options.method === 'installments'

    return {
        businessPartnerId: supplierId,
        supplierId,
        supplierName: 'Order Supplier',
        destinationStorageId: null,
        items: [{
            id: crypto.randomUUID(),
            productId: PRODUCT_ID,
            productName: 'Test Product',
            productSku: 'TEST-001',
            quantity: 1,
            lineTotal: total,
            originalCurrency: 'usd',
            originalUnitPrice: total,
            convertedUnitPrice: total,
            settlementCurrency: 'usd',
            receivedQuantity: 0,
            batchNumber: null,
            batchSalePrice: null,
            batchExpiryDate: null,
            batchManufacturingDate: null
        }],
        subtotal: total,
        discount: 0,
        total,
        currency: 'usd',
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        exchangeRates: null,
        status: 'draft',
        expectedDeliveryDate: null,
        actualDeliveryDate: null,
        isPaid: false,
        paymentStatus: initialPayment > 0 ? 'partial' : 'unpaid',
        paidAmount: initialPayment,
        balanceAmount: total - initialPayment,
        paidAt: null,
        paymentMethod: options.method,
        initialPaymentAmount: financed ? initialPayment : 0,
        linkedLoanId: null,
        isInstallmentBased: options.method === 'installments',
        installmentCount: options.method === 'installments' ? options.installmentCount ?? 2 : 0,
        installmentFrequency: financed ? 'monthly' : null,
        firstDueDate: financed ? options.firstDueDate ?? null : null,
        nextDueDate: financed ? options.firstDueDate ?? null : null,
        notes: 'Financing integration test',
        isLocked: false,
        createdBy: null
    }
}

describe('order-linked financing', () => {
    beforeAll(async () => {
        installBrowserStorage()
        const partners = await import('./businessPartners')
        const orders = await import('./orders')
        const loans = await import('./hooks')
        const payments = await import('./payments')
        createBusinessPartner = partners.createBusinessPartner
        createSalesOrder = orders.createSalesOrder
        createPurchaseOrder = orders.createPurchaseOrder
        updateSalesOrderStatus = orders.updateSalesOrderStatus
        updatePurchaseOrderStatus = orders.updatePurchaseOrderStatus
        recordOrderPayment = orders.recordOrderPayment
        createProduct = loans.createProduct
        createStorage = loans.createStorage
        recordLoanPayment = loans.recordLoanPayment
        buildPaymentObligations = payments.buildPaymentObligations
        reversePaymentTransaction = payments.reversePaymentTransaction
    })

    beforeEach(async () => {
        await db.delete()
        await db.open()
        writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: 'local' })
    })

    afterEach(() => {
        clearWorkspaceModeSnapshot(WORKSPACE_ID)
    })

    afterAll(async () => {
        await db.delete()
    })

    it('creates one standard borrowed loan and mirrors payments and reversals to the order', async () => {
        const supplier = await createSupplier(200)
        const draft = await createPurchaseOrder(
            WORKSPACE_ID,
            purchaseOrderInput(supplier.id, {
                method: 'installments',
                initialPayment: 20,
                firstDueDate: '2026-07-15',
                installmentCount: 2
            })
        )

        expect(await db.payment_transactions.count()).toBe(0)

        const activated = await updatePurchaseOrderStatus(draft.id, 'ordered')
        expect(activated.linkedLoanId).toBeTruthy()
        expect(activated).toMatchObject({
            paidAmount: 20,
            balanceAmount: 80,
            paymentStatus: 'partial',
            isPaid: false
        })

        const loan = await db.loans.get(activated.linkedLoanId!)
        expect(loan).toMatchObject({
            source: 'order',
            orderId: draft.id,
            orderType: 'purchase',
            direction: 'borrowed',
            loanCategory: 'standard',
            principalAmount: 80,
            balanceAmount: 80,
            installmentCount: 2
        })
        const installments = await db.loan_installments.where('loanId').equals(loan!.id).sortBy('installmentNo')
        expect(installments.map((item) => item.plannedAmount)).toEqual([40, 40])
        expect(await db.order_installments.where('orderId').equals(draft.id).count()).toBe(0)
        expect(await db.payment_transactions.count()).toBe(0)

        await recordLoanPayment(WORKSPACE_ID, {
            loanId: loan!.id,
            amount: 30,
            paymentMethod: 'cash',
            paidAt: '2026-07-15T12:00:00.000Z'
        })
        expect(await db.purchase_orders.get(draft.id)).toMatchObject({
            paidAmount: 50,
            balanceAmount: 50,
            paymentStatus: 'partial',
            isPaid: false
        })

        const paymentTransaction = (await db.payment_transactions
            .where('workspaceId')
            .equals(WORKSPACE_ID)
            .and((item) => item.sourceRecordId === loan!.id && !item.reversalOfTransactionId)
            .toArray())[0]
        expect(paymentTransaction?.sourceType).toBe('loan_installment')

        await reversePaymentTransaction(WORKSPACE_ID, paymentTransaction.id)
        expect(await db.purchase_orders.get(draft.id)).toMatchObject({
            paidAmount: 20,
            balanceAmount: 80,
            paymentStatus: 'partial',
            isPaid: false
        })
    })

    it('creates and accepts payments for a simple loan with a blank due-date entry', async () => {
        const supplier = await createSupplier(null)
        const draft = await createPurchaseOrder(
            WORKSPACE_ID,
            purchaseOrderInput(supplier.id, { method: 'loan', total: 75 })
        )
        const activated = await updatePurchaseOrderStatus(draft.id, 'ordered')
        const loan = await db.loans.get(activated.linkedLoanId!)

        expect(loan).toMatchObject({
            loanCategory: 'simple',
            firstDueDate: null,
            nextDueDate: null,
            installmentCount: 1,
            principalAmount: 75
        })
        const undatedSchedule = await db.loan_installments.where('loanId').equals(loan!.id).toArray()
        expect(undatedSchedule).toHaveLength(1)
        expect(undatedSchedule[0]).toMatchObject({
            installmentNo: 1,
            dueDate: null,
            plannedAmount: 75,
            paidAmount: 0,
            balanceAmount: 75,
            status: 'unpaid'
        })

        await recordLoanPayment(WORKSPACE_ID, {
            loanId: loan!.id,
            amount: 25,
            paymentMethod: 'cash'
        })
        expect(await db.loans.get(loan!.id)).toMatchObject({ totalPaidAmount: 25, balanceAmount: 50 })
        expect(await db.loan_installments.get(undatedSchedule[0].id)).toMatchObject({
            paidAmount: 25,
            balanceAmount: 50,
            status: 'partial'
        })
        expect(await db.purchase_orders.get(draft.id)).toMatchObject({ paidAmount: 25, balanceAmount: 50 })

        const datedDraft = await createPurchaseOrder(
            WORKSPACE_ID,
            purchaseOrderInput(supplier.id, {
                method: 'loan',
                total: 60,
                firstDueDate: '2026-08-20'
            })
        )
        const datedOrder = await updatePurchaseOrderStatus(datedDraft.id, 'ordered')
        const datedLoan = await db.loans.get(datedOrder.linkedLoanId!)
        const datedSchedule = await db.loan_installments.where('loanId').equals(datedLoan!.id).toArray()
        expect(datedLoan).toMatchObject({
            loanCategory: 'simple',
            firstDueDate: '2026-08-20',
            nextDueDate: '2026-08-20',
            installmentCount: 1
        })
        expect(datedSchedule).toHaveLength(1)
        expect(datedSchedule[0]).toMatchObject({ dueDate: '2026-08-20', plannedAmount: 60 })
    })

    it('shows a sales order loan as one order loan open item', async () => {
        const customer = await createCustomer()
        const { storage, product } = await createStockedSalesProduct()
        const draft = await createSalesOrder(
            WORKSPACE_ID,
            salesOrderInput(customer.id, product, storage.id, { method: 'loan' })
        )

        const pendingOrder = await updateSalesOrderStatus(draft.id, 'pending')
        expect(pendingOrder.linkedLoanId).toBeTruthy()

        const obligations = await buildPaymentObligations(WORKSPACE_ID, {})
        const orderLoanObligation = obligations.find((item) =>
            item.sourceType === 'simple_loan'
            && item.metadata?.orderId === pendingOrder.id
            && item.metadata?.orderType === 'sales'
        )

        expect(orderLoanObligation).toMatchObject({
            sourceModule: 'loans',
            sourceType: 'simple_loan',
            amount: 15000,
            subtitle: 'Order loan balance',
            metadata: expect.objectContaining({
                displaySourceLabel: 'order_loan',
                orderId: pendingOrder.id,
                orderType: 'sales'
            })
        })
        expect(obligations.filter((item) =>
            item.sourceType === 'sales_order' && item.sourceRecordId === pendingOrder.id
        )).toHaveLength(0)
        expect(obligations.filter((item) =>
            item.sourceRecordId === pendingOrder.id || item.metadata?.orderId === pendingOrder.id
        )).toHaveLength(1)
    })

    it('records fractional IQD order payments against old rounded balances', async () => {
        const customer = await createCustomer()
        const order = salesOrderWithStaleRoundedBalance(customer.id)
        await db.sales_orders.put(order)

        await recordOrderPayment(WORKSPACE_ID, {
            orderType: 'sales',
            orderId: order.id,
            amount: 688.5,
            paymentMethod: 'cash',
            paidAt: '2026-06-28T16:08:00.000Z'
        })

        expect(await db.sales_orders.get(order.id)).toMatchObject({
            paidAmount: 688.5,
            balanceAmount: 0,
            paymentStatus: 'paid',
            isPaid: true
        })
        expect(await db.payment_transactions.where('sourceRecordId').equals(order.id).count()).toBe(1)
    })

    it('repairs an order if a stale rounded payment exists from a failed attempt', async () => {
        const customer = await createCustomer()
        const order = salesOrderWithStaleRoundedBalance(customer.id)
        await db.sales_orders.put(order)
        await db.payment_transactions.put({
            id: crypto.randomUUID(),
            workspaceId: WORKSPACE_ID,
            sourceModule: 'orders',
            sourceType: 'sales_order',
            sourceRecordId: order.id,
            sourceSubrecordId: null,
            direction: 'incoming',
            amount: 689,
            currency: 'iqd',
            paymentMethod: 'cash',
            paidAt: '2026-06-28T16:08:00.000Z',
            counterpartyName: order.customerName,
            referenceLabel: order.orderNumber,
            note: null,
            createdBy: null,
            reversalOfTransactionId: null,
            metadata: { orderType: 'sales' },
            createdAt: '2026-06-28T16:08:00.000Z',
            updatedAt: '2026-06-28T16:08:00.000Z',
            syncStatus: 'synced',
            lastSyncedAt: '2026-06-28T16:08:00.000Z',
            version: 1,
            isDeleted: false
        })

        await recordOrderPayment(WORKSPACE_ID, {
            orderType: 'sales',
            orderId: order.id,
            amount: 688.5,
            paymentMethod: 'cash',
            paidAt: '2026-06-28T16:09:00.000Z'
        })

        expect(await db.sales_orders.get(order.id)).toMatchObject({
            paidAmount: 688.5,
            balanceAmount: 0,
            paymentStatus: 'paid',
            isPaid: true
        })
        const transactions = await db.payment_transactions.where('sourceRecordId').equals(order.id).toArray()
        expect(transactions).toHaveLength(1)
        expect(transactions[0].amount).toBe(688.5)
    })

    it('collapses duplicate failed full-payment attempts before rebuilding the order', async () => {
        const customer = await createCustomer()
        const order = salesOrderWithStaleRoundedBalance(customer.id)
        await db.sales_orders.put(order)
        const basePayment = {
            workspaceId: WORKSPACE_ID,
            sourceModule: 'orders' as const,
            sourceType: 'sales_order' as const,
            sourceRecordId: order.id,
            sourceSubrecordId: null,
            direction: 'incoming' as const,
            currency: 'iqd' as const,
            paymentMethod: 'cash' as const,
            paidAt: '2026-06-28T16:08:00.000Z',
            counterpartyName: order.customerName,
            referenceLabel: order.orderNumber,
            note: null,
            createdBy: null,
            reversalOfTransactionId: null,
            metadata: { orderType: 'sales' },
            createdAt: '2026-06-28T16:08:00.000Z',
            updatedAt: '2026-06-28T16:08:00.000Z',
            syncStatus: 'synced' as const,
            lastSyncedAt: '2026-06-28T16:08:00.000Z',
            version: 1,
            isDeleted: false
        }
        await db.payment_transactions.bulkPut([
            { ...basePayment, id: crypto.randomUUID(), amount: 689 },
            { ...basePayment, id: crypto.randomUUID(), amount: 688.5, paidAt: '2026-06-28T16:09:00.000Z' }
        ])

        await recordOrderPayment(WORKSPACE_ID, {
            orderType: 'sales',
            orderId: order.id,
            amount: 688.5,
            paymentMethod: 'cash',
            paidAt: '2026-06-28T16:10:00.000Z'
        })

        expect(await db.sales_orders.get(order.id)).toMatchObject({
            paidAmount: 688.5,
            balanceAmount: 0,
            paymentStatus: 'paid',
            isPaid: true
        })
        const transactions = await db.payment_transactions.where('sourceRecordId').equals(order.id).toArray()
        expect(transactions.filter((transaction) => !transaction.isDeleted)).toHaveLength(1)
        expect(transactions.find((transaction) => !transaction.isDeleted)?.amount).toBe(688.5)
        expect(transactions.filter((transaction) => transaction.isDeleted)).toHaveLength(1)
    })

    it('enforces the payable credit limit and requires regular tenders to be fully paid', async () => {
        const limitedSupplier = await createSupplier(50)
        const financedDraft = await createPurchaseOrder(
            WORKSPACE_ID,
            purchaseOrderInput(limitedSupplier.id, { method: 'loan', total: 80 })
        )

        await expect(updatePurchaseOrderStatus(financedDraft.id, 'ordered')).rejects.toThrow('credit_limit_exceeded')
        expect((await db.purchase_orders.get(financedDraft.id))?.status).toBe('draft')
        expect(await db.loans.where('orderId').equals(financedDraft.id).count()).toBe(0)

        const unlimitedSupplier = await createSupplier(null)
        const unpaidCashDraft = await createPurchaseOrder(
            WORKSPACE_ID,
            purchaseOrderInput(unlimitedSupplier.id, { method: 'cash', total: 80 })
        )
        await expect(updatePurchaseOrderStatus(unpaidCashDraft.id, 'ordered')).rejects.toThrow('non_financed_order_must_be_paid')
    })
})
