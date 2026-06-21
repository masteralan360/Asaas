import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'
import type { PurchaseOrder } from './models'

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

let createBusinessPartner: typeof import('./businessPartners').createBusinessPartner
let createPurchaseOrder: typeof import('./orders').createPurchaseOrder
let updatePurchaseOrderStatus: typeof import('./orders').updatePurchaseOrderStatus
let recordLoanPayment: typeof import('./hooks').recordLoanPayment
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
        createPurchaseOrder = orders.createPurchaseOrder
        updatePurchaseOrderStatus = orders.updatePurchaseOrderStatus
        recordLoanPayment = loans.recordLoanPayment
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

    it('creates and accepts payments for a simple loan without a due date or installment rows', async () => {
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
            installmentCount: 0,
            principalAmount: 75
        })
        expect(await db.loan_installments.where('loanId').equals(loan!.id).count()).toBe(0)

        await recordLoanPayment(WORKSPACE_ID, {
            loanId: loan!.id,
            amount: 25,
            paymentMethod: 'cash'
        })
        expect(await db.loans.get(loan!.id)).toMatchObject({ totalPaidAmount: 25, balanceAmount: 50 })
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
