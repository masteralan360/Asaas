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

import type { PurchaseOrder, SalesOrder } from '@/local-db'
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

async function renderPrintTemplate(printLang: 'en' | 'ar', overrides: { showPaidAmount?: boolean; showRemainingAmount?: boolean; salesOrders?: SalesOrder[]; purchaseOrders?: PurchaseOrder[] } = {}) {
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
        purchaseOrders: overrides.purchaseOrders ?? [purchaseOrder()]
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
        expect(html.match(/data-order-items-section-title-bar/g)).toHaveLength(2)
        expect(html.match(/data-order-items-section-order-count/g)).toHaveLength(2)
        expect(html.match(/data-order-items-section(?!-)/g)).toHaveLength(2)
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

    it('renders no tables at all when the partner has no orders', async () => {
        const html = await renderPrintTemplate('en', {
            salesOrders: [],
            purchaseOrders: []
        })

        expect(html).not.toContain('data-order-items-paginated')
        expect(html).not.toContain('data-order-items-section')
        expect(html).not.toContain('Sales Order Items')
        expect(html).not.toContain('Purchase Order Items')
        expect(html).not.toContain('<table')
    })

    it('skips only the empty order section', async () => {
        const html = await renderPrintTemplate('en', {
            purchaseOrders: []
        })

        expect(html.match(/data-order-items-paginated/g)).toHaveLength(1)
        expect(html).toContain('Sales Order Items')
        expect(html).not.toContain('Purchase Order Items')
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
