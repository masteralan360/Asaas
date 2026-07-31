import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

vi.mock('@/lib/utils', () => ({
    formatCurrency: (amount: number, currency: string) => `${amount} ${currency}`,
    formatDate: (value: string) => value,
    formatDateTime: (value: string) => value
}))

vi.mock('@/services/platformService', () => ({
    platformService: {
        convertFileSrc: (path: string) => path
    }
}))

import type { Loan, LoanPayment, PaymentTransaction, PurchaseOrder, SalesOrder } from '@/local-db'
import {
    PartnerOrderItemsPrintTemplate,
    type PartnerOrderItemsPrintData
} from './PartnerOrderItemsPrintTemplate'

const createdAt = '2026-07-01T08:00:00.000Z'

function salesOrder(overrides: Partial<SalesOrder> = {}): SalesOrder {
    return {
        id: 'sales-order-0004',
        workspaceId: 'workspace-1',
        orderNumber: '0004',
        customerId: 'partner-1',
        customerName: 'Business Partner',
        items: [{
            id: 'item-1',
            productId: 'product-1',
            productName: 'Product 1',
            productSku: 'PRODUCT-1',
            note: 'First item note',
            unit: 'pcs',
            quantity: 2,
            lineTotal: 10,
            originalCurrency: 'usd',
            originalUnitPrice: 5,
            convertedUnitPrice: 5,
            settlementCurrency: 'usd',
            costPrice: 3,
            convertedCostPrice: 3
        }],
        subtotal: 10,
        discount: 0,
        tax: 0,
        total: 10,
        currency: 'usd',
        orderAdjustments: [],
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        status: 'completed',
        isPaid: false,
        paymentStatus: 'partial',
        paidAmount: 0,
        balanceAmount: 10,
        initialPaymentAmount: 0,
        isInstallmentBased: false,
        installmentCount: 0,
        createdAt,
        updatedAt: createdAt,
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
        ...overrides
    }
}

function purchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return {
        id: 'purchase-order-0005',
        workspaceId: 'workspace-1',
        orderNumber: '0005',
        supplierId: 'partner-1',
        supplierName: 'Business Partner',
        items: [{
            id: 'purchase-item-1',
            productId: 'product-3',
            productName: 'Product 3',
            productSku: 'PRODUCT-3',
            unit: 'box',
            quantity: 1,
            lineTotal: 11,
            originalCurrency: 'usd',
            originalUnitPrice: 11,
            convertedUnitPrice: 11,
            settlementCurrency: 'usd'
        }],
        subtotal: 11,
        discount: 0,
        total: 11,
        currency: 'usd',
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        status: 'received',
        isPaid: true,
        paymentStatus: 'paid',
        paidAmount: 11,
        balanceAmount: 0,
        initialPaymentAmount: 0,
        isInstallmentBased: false,
        installmentCount: 0,
        createdAt,
        updatedAt: createdAt,
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
        ...overrides
    }
}

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: 'loan-1',
        workspaceId: 'workspace-1',
        loanNo: 'LN-001',
        source: 'manual',
        loanCategory: 'simple',
        direction: 'lent',
        linkedPartyType: 'business_partner',
        linkedPartyId: 'partner-1',
        borrowerName: 'Business Partner',
        borrowerPhone: '',
        borrowerAddress: '',
        borrowerNationalId: '',
        principalAmount: 500,
        totalPaidAmount: 100,
        balanceAmount: 400,
        settlementCurrency: 'usd',
        exchangeRateSnapshot: null,
        installmentCount: 5,
        installmentFrequency: 'monthly',
        firstDueDate: null,
        status: 'active',
        createdAt,
        updatedAt: createdAt,
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
        ...overrides
    }
}

function loanPayment(overrides: Partial<LoanPayment> = {}): LoanPayment {
    return {
        id: 'loan-payment-1',
        loanId: 'loan-1',
        workspaceId: 'workspace-1',
        amount: 100,
        paymentMethod: 'cash',
        paidAt: '2026-07-03T10:00:00.000Z',
        note: 'Second installment',
        createdAt: '2026-07-03T10:00:00.000Z',
        updatedAt: '2026-07-03T10:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
        ...overrides
    }
}

function directTransaction(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
    return {
        id: 'direct-tx-1',
        workspaceId: 'workspace-1',
        sourceModule: 'payments',
        sourceType: 'direct_transaction',
        sourceRecordId: 'direct-tx-1',
        sourceSubrecordId: 'partner-1',
        direction: 'incoming',
        amount: 50,
        currency: 'usd',
        paymentMethod: 'cash',
        paidAt: '2026-07-02T10:00:00.000Z',
        referenceLabel: 'Cash received',
        note: null,
        createdAt: '2026-07-02T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
        metadata: { reason: 'Cash received', businessPartnerId: 'partner-1' },
        ...overrides
    }
}

async function renderPrintTemplate(printLang: 'en' | 'ar', overrides: {
    showPaidAmount?: boolean
    showRemainingAmount?: boolean
    salesOrders?: SalesOrder[]
    purchaseOrders?: PurchaseOrder[]
    loans?: Loan[]
    loanPayments?: LoanPayment[]
    directTransactions?: PaymentTransaction[]
} = {}) {
    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
        lng: printLang,
        resources: {
            en: {
                translation: {
                    businessPartners: {
                        orderItemsPrint: { continued: 'Continued', cancelled: 'Cancelled' }
                    }
                }
            },
            ar: {
                translation: {
                    businessPartners: {
                        orderItemsPrint: { continued: 'متابعة', cancelled: 'ملغى' }
                    }
                }
            }
        }
    })

    const data: PartnerOrderItemsPrintData = {
        partner: { name: 'Business Partner' },
        period: { type: 'allTime' },
        generatedAt: '2026-07-06T18:51:00.000Z',
        salesOrders: overrides.salesOrders ?? [salesOrder()],
        purchaseOrders: overrides.purchaseOrders ?? [purchaseOrder()],
        loans: overrides.loans ?? [loan()],
        loanPayments: overrides.loanPayments ?? [],
        directTransactions: overrides.directTransactions ?? []
    }

    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <PartnerOrderItemsPrintTemplate
                workspaceName="Test Workspace"
                printLang={printLang}
                data={data}
                showPaidAmount={overrides.showPaidAmount ?? true}
                showRemainingAmount={overrides.showRemainingAmount ?? true}
            />
        </I18nextProvider>
    )
}

describe('PartnerOrderItemsPrintTemplate pagination markers', () => {
    it('marks every statement table and title bar for the paginator', async () => {
        const html = await renderPrintTemplate('en')

        expect(html.match(/data-order-items-paginated/g)).toHaveLength(2)
        expect(html.match(/data-order-items-section-title-bar/g)).toHaveLength(1)
        expect(html.match(/data-order-items-section-order-count/g)).toHaveLength(1)
        expect(html.match(/data-order-items-section(?!-)/g)).toHaveLength(1)
        expect(html.match(/data-order-items-section-summary/g)).toHaveLength(2)
        expect(html.match(/data-order-statement-block/g)).toHaveLength(2)
    })

    it('renders one atomic table per order so the page packer can move whole orders', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [
                salesOrder({ id: 'sales-order-0001', orderNumber: '0001', items: [salesOrder().items[0]] }),
                salesOrder({ id: 'sales-order-0002', orderNumber: '0002', items: [salesOrder().items[0]] })
            ],
            purchaseOrders: []
        })

        expect(html.match(/data-order-items-paginated/g)).toHaveLength(2)
        expect(html.match(/data-order-statement-block/g)).toHaveLength(2)
        expect(html).toContain('data-page-padding-mm="10"')
    })

    it('carries the translated continuation label on the title bars', async () => {
        const englishHtml = await renderPrintTemplate('en')
        expect(englishHtml).toContain('data-order-items-continuation-label="(Continued)"')

        const arabicHtml = await renderPrintTemplate('ar')
        expect(arabicHtml).toContain('data-order-items-continuation-label="(متابعة)"')
    })

    it('shows paid and remaining amounts inline inside the order total row', async () => {
        const html = await renderPrintTemplate('en')

        expect(html).toContain('Order total<span class="ms-2">Paid: 0 usd</span>')
        expect(html).toContain('Remaining: 10 usd')
        expect(html).toContain('Paid: 11 usd')
    })

    it('hides the paid and remaining amounts when their toggles are off', async () => {
        const html = await renderPrintTemplate('en', {
            showPaidAmount: false,
            showRemainingAmount: false
        })

        expect(html).not.toContain('Paid: 0 usd')
        expect(html).not.toContain('Remaining: 10 usd')
    })

    it('skips the whole timeline when the partner has no activity', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [],
            purchaseOrders: [],
            loanPayments: [],
            directTransactions: []
        })

        expect(html).not.toContain('data-order-items-paginated')
        expect(html).not.toContain('data-order-items-section')
        expect(html).not.toContain('Account Activity')
        expect(html).not.toContain('<table')
    })

    it('renders the merged timeline with only the orders that exist', async () => {
        const html = await renderPrintTemplate('en', {
            purchaseOrders: []
        })

        expect(html.match(/data-order-items-paginated/g)).toHaveLength(1)
        expect(html.match(/data-order-statement-block/g)).toHaveLength(1)
        expect(html).toContain('Account Activity')
    })

    it('interleaves loan repayments and direct transactions into the timeline', async () => {
        const html = await renderPrintTemplate('en', {
            loanPayments: [loanPayment()],
            directTransactions: [directTransaction()]
        })

        expect(html.match(/data-order-statement-block/g)).toHaveLength(4)
        expect(html.match(/data-order-items-section-summary/g)).toHaveLength(4)
        expect(html).toContain('Loan Repayment')
        expect(html).toContain('>LN-001</span>')
        expect(html).toContain('Direct Transaction')
        expect(html).toContain('>Cash received</span>')
        expect(html).toContain('>Received</span>')
        expect(html).toContain('+ 100 usd')
        expect(html).toContain('+ 50 usd')
        expect(html).toContain('>4 Entries</span>')
    })

    it('flags outgoing movements as Paid with a negative-style amount', async () => {
        const html = await renderPrintTemplate('en', {
            loanPayments: [loanPayment({ id: 'loan-payment-2', amount: 30, paidAt: '2026-07-04T10:00:00.000Z' })],
            directTransactions: [],
            loans: [loan({ direction: 'borrowed', loanNo: 'LN-002' })]
        })

        expect(html).toContain('>Paid</span>')
        expect(html).toContain('− 30 usd')
        expect(html).not.toContain('>Received</span>')
    })

    it('draws direction-colored hierarchy lines on money movement rows', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [],
            purchaseOrders: [],
            loanPayments: [loanPayment()],
            directTransactions: [directTransaction({ direction: 'outgoing', referenceLabel: 'Paid out' })]
        })

        expect(html).toContain('bg-emerald-600')
        expect(html).toContain('bg-rose-600')
        expect(html).not.toContain('bg-sky-600')
        expect(html).not.toContain('bg-amber-600')
        expect(html).toContain('>Received</span>')
        expect(html).toContain('>Paid</span>')
    })

    it('shows the loan repayment and direct transaction summaries at the end', async () => {
        const html = await renderPrintTemplate('en', {
            loanPayments: [loanPayment()],
            directTransactions: [directTransaction()]
        })

        expect(html).toContain('Loan Repayments')
        expect(html).toContain('Direct Transactions')
        expect(html).toContain('1 Entries')
        expect(html).toContain('Received: <strong>+100 usd</strong>')
        expect(html).toContain('Received: <strong>+50 usd</strong>')
    })

    it('excludes cancelled orders from the tables entirely', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [salesOrder({ status: 'cancelled' })],
            purchaseOrders: []
        })

        expect(html).not.toContain('data-order-items-paginated')
        expect(html).not.toContain('<table')
        expect(html).not.toContain('>Cancelled</span>')
    })

    it('marks returned orders with a rose hierarchy line and a returned badge', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [salesOrder({ returnStatus: 'full', returnedAt: createdAt })],
            purchaseOrders: []
        })

        expect(html).toContain('bg-rose-600')
        expect(html).not.toContain('bg-emerald-600')
        expect(html).toContain('>Returned</span>')
        expect(html).not.toContain('>Cancelled</span>')
    })

    it('draws partially paid order lines in sky blue', async () => {
        const html = await renderPrintTemplate('en')

        expect(html).toContain('bg-sky-600')
        expect(html).toContain('bg-emerald-600')
        expect(html).not.toContain('bg-rose-600')
        expect(html).not.toContain('bg-amber-600')
    })

    it('draws unpaid order lines in yellow', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [salesOrder({ paymentStatus: 'unpaid' })],
            purchaseOrders: []
        })

        expect(html).toContain('bg-amber-600')
        expect(html).not.toContain('bg-emerald-600')
        expect(html).not.toContain('bg-sky-600')
        expect(html).not.toContain('bg-rose-600')
    })

    it('keeps paid orders on their green hierarchy lines', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [salesOrder({ paymentStatus: 'paid' })],
            purchaseOrders: [purchaseOrder({ paymentStatus: 'paid' })]
        })

        expect(html).toContain('bg-emerald-600')
        expect(html).not.toContain('bg-rose-600')
        expect(html).not.toContain('bg-sky-600')
        expect(html).not.toContain('bg-amber-600')
        expect(html).not.toContain('>Cancelled</span>')
    })
})
