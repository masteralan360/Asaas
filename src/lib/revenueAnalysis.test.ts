import { describe, expect, it } from 'vitest'

import type { SalesOrder } from '@/local-db'

import { getRevenueAnalysisTotals, getRevenueProductSalesSummary, getRevenueRecordReturnSummary, toRevenueRecordFromSalesOrder, type RevenueAnalysisRecord } from './revenueAnalysis'

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

  it('deducts returned order quantities and exposes the partial return in analytics', () => {
    const order = {
      id: 'order-returned-1',
      orderNumber: 'SO-RETURN-1',
      customerId: 'customer-1',
      customerName: 'Customer',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currency: 'usd',
      status: 'completed',
      returnStatus: 'partial',
      isDeleted: false,
      total: 30,
      items: [{
        id: 'line-1',
        productId: 'product-1',
        productName: 'Product',
        productSku: 'SKU-1',
        quantity: 5,
        lineTotal: 50,
        originalCurrency: 'usd',
        originalUnitPrice: 10,
        convertedUnitPrice: 10,
        settlementCurrency: 'usd',
        costPrice: 4,
        convertedCostPrice: 4,
        returnedQuantity: 2
      }]
    } as SalesOrder

    const record = toRevenueRecordFromSalesOrder(order)
    const totals = getRevenueAnalysisTotals(record)

    expect(totals).toMatchObject({ revenue: 30, cost: 12, profit: 18 })
    expect(getRevenueRecordReturnSummary(record)).toMatchObject({
      isFullyReturned: false,
      hasAnyReturn: true,
      totalReturnedQuantity: 2
    })
  })

  it('excludes a fully returned order from revenue totals', () => {
    const order = {
      id: 'order-returned-2',
      orderNumber: 'SO-RETURN-2',
      customerId: 'customer-1',
      customerName: 'Customer',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currency: 'usd',
      status: 'completed',
      returnStatus: 'full',
      isDeleted: false,
      total: 0,
      items: [{
        id: 'line-1',
        productId: 'product-1',
        productName: 'Product',
        productSku: 'SKU-1',
        quantity: 5,
        lineTotal: 50,
        originalCurrency: 'usd',
        originalUnitPrice: 10,
        convertedUnitPrice: 10,
        settlementCurrency: 'usd',
        costPrice: 4,
        convertedCostPrice: 4,
        returnedQuantity: 5
      }]
    } as SalesOrder

    expect(getRevenueAnalysisTotals(toRevenueRecordFromSalesOrder(order))).toMatchObject({
      revenue: 0,
      cost: 0,
      profit: 0
    })
  })

  it('summarizes distinct products and net units while preserving the selected sale count', () => {
    const records: RevenueAnalysisRecord[] = [
      {
        key: 'sale:1', id: '1', source: 'sale', referenceCode: 'S-1', date: '2026-01-01T00:00:00.000Z', currency: 'usd', origin: 'pos', cashier: 'Staff', hasPartialReturn: true, isReturned: false,
        items: [
          { productId: 'product-a', productName: 'Product A', quantity: 5, returnedQuantity: 2, unitPrice: 10, costPrice: 4 },
          { productId: 'product-b', productName: 'Product B', quantity: 1, returnedQuantity: 1, unitPrice: 10, costPrice: 4 }
        ]
      },
      {
        key: 'sale:2', id: '2', source: 'sale', referenceCode: 'S-2', date: '2026-01-02T00:00:00.000Z', currency: 'usd', origin: 'pos', cashier: 'Staff', hasPartialReturn: false, isReturned: false,
        items: [{ productId: 'product-a', productName: 'Product A', quantity: 2, returnedQuantity: 0, unitPrice: 10, costPrice: 4 }]
      },
      {
        key: 'sale:3', id: '3', source: 'sale', referenceCode: 'S-3', date: '2026-01-03T00:00:00.000Z', currency: 'usd', origin: 'pos', cashier: 'Staff', hasPartialReturn: false, isReturned: true,
        items: [{ productId: 'product-c', productName: 'Product C', quantity: 4, returnedQuantity: 0, unitPrice: 10, costPrice: 4 }]
      }
    ]

    expect(getRevenueProductSalesSummary(records)).toEqual({
      totalSales: 3,
      productsSold: 1,
      unitsSold: 5
    })
  })
})
