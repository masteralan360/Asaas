import { describe, expect, it, vi } from 'vitest'

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
    buildPartnerOrderItemsPrintSection,
    getPartnerOrderItemsPrintRowHierarchy
} from './PartnerOrderItemsPrintTemplate'

const createdAt = '2026-07-01T08:00:00.000Z'

function salesOrder(overrides: Partial<SalesOrder> = {}): SalesOrder {
    return {
        id: 'sales-order-0004',
        workspaceId: 'workspace-1',
        orderNumber: '0004',
        customerId: 'partner-1',
        customerName: 'Business Partner',
        items: [
            {
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
            },
            {
                id: 'item-2',
                productId: 'product-2',
                productName: 'Product 2',
                productSku: 'PRODUCT-2',
                unit: 'pcs',
                quantity: 2,
                lineTotal: 10,
                originalCurrency: 'usd',
                originalUnitPrice: 5,
                convertedUnitPrice: 5,
                settlementCurrency: 'usd',
                costPrice: 3,
                convertedCostPrice: 3
            }
        ],
        subtotal: 20,
        discount: 3,
        tax: 2,
        total: 25,
        currency: 'usd',
        orderAdjustments: [
            {
                id: 'delivery',
                type: 'addition',
                name: 'Delivery',
                currency: 'usd',
                amount: 7,
                orderCurrency: 'usd',
                convertedAmount: 7,
                exchangeRate: 1,
                exchangeRateSource: 'native',
                exchangeRateTimestamp: createdAt,
                exchangeRates: []
            },
            {
                id: 'credit',
                type: 'deduction',
                name: 'Customer credit',
                currency: 'usd',
                amount: 1,
                orderCurrency: 'usd',
                convertedAmount: 1,
                exchangeRate: 1,
                exchangeRateSource: 'native',
                exchangeRateTimestamp: createdAt,
                exchangeRates: []
            }
        ],
        exchangeRate: null,
        exchangeRateSource: null,
        exchangeRateTimestamp: null,
        status: 'completed',
        isPaid: false,
        paymentStatus: 'partial',
        paidAmount: 5,
        balanceAmount: 20,
        initialPaymentAmount: 0,
        isInstallmentBased: false,
        installmentCount: 0,
        notes: 'Order-level note',
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

describe('buildPartnerOrderItemsPrintSection', () => {
    it('keeps every sales item and commercial row tied to its repeated order code', () => {
        const section = buildPartnerOrderItemsPrintSection([salesOrder()], 'sales')

        expect(section.rows.map((row) => row.orderCode)).toEqual([
            '0004', '0004', '0004', '0004', '0004', '0004', '0004', '0004'
        ])
        expect(section.rows.map((row) => row.kind)).toEqual([
            'item', 'item', 'discount', 'tax', 'adjustment', 'adjustment', 'order_note', 'order_total'
        ])
        expect(section.rows.find((row) => row.kind === 'item')?.note).toBe('First item note')
        expect(section.rows.find((row) => row.kind === 'order_note')?.note).toBe('Order-level note')
        expect(section.rows.filter((row) => row.kind === 'adjustment').map((row) => row.amount)).toEqual([7, -1])
        expect(section.rows.find((row) => row.kind === 'discount')?.amount).toBe(-3)
        expect(section.rows.find((row) => row.kind === 'tax')?.amount).toBe(2)
        expect(section.rows.find((row) => row.kind === 'order_total')).toMatchObject({
            amount: 25,
            paidAmount: 5,
            remainingAmount: 20
        })
        expect(section.rows.map((_, index) => getPartnerOrderItemsPrintRowHierarchy(section.rows, index))).toEqual([
            'first', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'last'
        ])
        expect(section.summaries).toEqual([{
            currency: 'usd',
            orderCount: 1,
            itemSubtotal: 20,
            discount: 3,
            tax: 2,
            additions: 7,
            deductions: 1,
            total: 25,
            paidAmount: 5,
            remainingAmount: 20
        }])
    })

    it('excludes cancelled orders from rows and summaries entirely, and does not create a tax row for purchase orders', () => {
        const section = buildPartnerOrderItemsPrintSection([
            purchaseOrder(),
            salesOrder({
                id: 'cancelled',
                orderNumber: '0006',
                status: 'cancelled',
                items: [{
                    id: 'item-1',
                    productId: 'product-1',
                    productName: 'Product 1',
                    productSku: 'PRODUCT-1',
                    note: null,
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
                discount: 0,
                tax: 0,
                orderAdjustments: [],
                notes: undefined
            })
        ], 'purchase')

        expect(section.rows.map((row) => row.orderCode)).toEqual(['0005', '0005'])
        expect(section.rows.some((row) => row.kind === 'tax')).toBe(false)
        expect(section.summaries).toEqual([{
            currency: 'usd',
            orderCount: 1,
            itemSubtotal: 11,
            discount: 0,
            tax: 0,
            additions: 0,
            deductions: 0,
            total: 11,
            paidAmount: 11,
            remainingAmount: 0
        }])
        expect(section.rows.map((_, index) => getPartnerOrderItemsPrintRowHierarchy(section.rows, index))).toEqual([
            'first', 'last'
        ])
    })

    it('flags every row of a returned sales order, whether partially or fully returned', () => {
        const section = buildPartnerOrderItemsPrintSection([
            salesOrder({ id: 'partially-returned', orderNumber: '0007', returnStatus: 'partial', returnedAt: createdAt }),
            salesOrder({ id: 'fully-returned', orderNumber: '0008', returnStatus: 'full', returnedAt: createdAt }),
            salesOrder({ id: 'intact', orderNumber: '0009', returnStatus: 'none' })
        ], 'sales')

        expect(section.rows.filter((row) => row.orderId === 'partially-returned').every((row) => row.isReturned)).toBe(true)
        expect(section.rows.filter((row) => row.orderId === 'fully-returned').every((row) => row.isReturned)).toBe(true)
        expect(section.rows.filter((row) => row.orderId === 'intact').every((row) => row.isReturned)).toBe(false)
    })

    it('never flags purchase-order rows as returned', () => {
        const section = buildPartnerOrderItemsPrintSection([purchaseOrder()], 'purchase')

        expect(section.rows.every((row) => !row.isReturned)).toBe(true)
    })

    it('flags rows of partially paid orders in both sections', () => {
        const sales = buildPartnerOrderItemsPrintSection([
            salesOrder({ id: 'partial', orderNumber: '0010', paymentStatus: 'partial' }),
            salesOrder({ id: 'paid', orderNumber: '0011', paymentStatus: 'paid' }),
            salesOrder({ id: 'unpaid', orderNumber: '0012', paymentStatus: 'unpaid' })
        ], 'sales')

        expect(sales.rows.filter((row) => row.orderId === 'partial').every((row) => row.isPartialPaid)).toBe(true)
        expect(sales.rows.filter((row) => row.orderId === 'paid').every((row) => row.isPartialPaid)).toBe(false)
        expect(sales.rows.filter((row) => row.orderId === 'unpaid').every((row) => row.isPartialPaid)).toBe(false)

        const purchase = buildPartnerOrderItemsPrintSection([
            purchaseOrder({ id: 'partial-purchase', orderNumber: '0013', paymentStatus: 'partial' }),
            purchaseOrder({ id: 'paid-purchase', orderNumber: '0014', paymentStatus: 'paid' })
        ], 'purchase')

        expect(purchase.rows.filter((row) => row.orderId === 'partial-purchase').every((row) => row.isPartialPaid)).toBe(true)
        expect(purchase.rows.filter((row) => row.orderId === 'paid-purchase').every((row) => row.isPartialPaid)).toBe(false)
    })
})
