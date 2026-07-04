import { describe, expect, it } from 'vitest'

import type { SalesOrder } from '@/local-db'

import { getRevenueAnalysisTotals, toRevenueRecordFromSalesOrder } from './revenueAnalysis'

describe('sales order revenue analysis', () => {
  it('charges revenue on paid quantity and cost on paid plus free bonus quantity', () => {
    const order = {
      id: 'order-1',
      orderNumber: 'SO-1',
      customerId: 'customer-1',
      customerName: 'Customer',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currency: 'usd',
      status: 'completed',
      isDeleted: false,
      total: 50,
      items: [{
        id: 'line-1',
        productId: 'product-1',
        productName: 'Product',
        productSku: 'SKU-1',
        quantity: 5,
        freeBonusQuantity: 2,
        lineTotal: 50,
        originalCurrency: 'usd',
        originalUnitPrice: 10,
        convertedUnitPrice: 10,
        settlementCurrency: 'usd',
        costPrice: 4,
        convertedCostPrice: 4
      }]
    } as SalesOrder

    const totals = getRevenueAnalysisTotals(toRevenueRecordFromSalesOrder(order))

    expect(totals.revenue).toBe(50)
    expect(totals.cost).toBe(28)
    expect(totals.profit).toBe(22)
  })
})
