import { describe, expect, it } from 'vitest'

import type { CategoryDiscount, Inventory, Product, ProductDiscount } from '@/local-db/models'
import { resolveActiveDiscountForPriceContext } from './discounts'

const timestamp = '2026-08-14T09:00:00.000Z'
const activeWindow = {
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-31T00:00:00.000Z',
    isActive: true,
    minStockThreshold: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'synced' as const,
    lastSyncedAt: timestamp,
    version: 1,
    isDeleted: false
}

const product = {
    id: 'product-1',
    workspaceId: 'workspace-1',
    name: 'Scoped Product',
    sku: 'SCOPED-1',
    categoryId: 'category-1',
    price: 100,
    currency: 'usd',
    isDeleted: false
} as Product

const inventory = [{
    id: 'inventory-1',
    workspaceId: 'workspace-1',
    productId: product.id,
    storageId: 'storage-1',
    quantity: 10,
    isDeleted: false
}] as Inventory[]

function productDiscount(overrides: Partial<ProductDiscount> = {}): ProductDiscount {
    return {
        ...activeWindow,
        id: 'product-discount-1',
        workspaceId: 'workspace-1',
        productId: product.id,
        discountType: 'percentage',
        discountValue: 10,
        priceScope: 'all',
        priceBookIds: [],
        discountCurrency: null,
        ...overrides
    }
}

function categoryDiscount(overrides: Partial<CategoryDiscount> = {}): CategoryDiscount {
    return {
        ...activeWindow,
        id: 'category-discount-1',
        workspaceId: 'workspace-1',
        categoryId: 'category-1',
        discountType: 'percentage',
        discountValue: 5,
        ...overrides
    }
}

function resolve(discounts: ProductDiscount[], priceBookId: string | null, basePrice = 100, currency: 'usd' | 'iqd' = 'usd') {
    return resolveActiveDiscountForPriceContext({
        product,
        productDiscounts: discounts,
        categoryDiscounts: [categoryDiscount()],
        inventoryRows: inventory,
        context: { priceBookId, basePrice, currency },
        now: new Date('2026-08-14T12:00:00.000Z')
    })
}

describe('scoped product discounts', () => {
    it('applies an all-pricing product rule to a Price Book base price', () => {
        const discount = resolve([productDiscount()], 'price-book-1', 80)

        expect(discount).toMatchObject({ source: 'product', originalPrice: 80, discountPrice: 72 })
    })

    it('uses a native-only rule only without a Price Book and otherwise falls back to category', () => {
        const nativeOnly = productDiscount({ priceScope: 'native_only' })

        expect(resolve([nativeOnly], null)?.source).toBe('product')
        expect(resolve([nativeOnly], 'price-book-1')?.source).toBe('category')
    })

    it('applies a specific Price Book rule only to its selected books', () => {
        const specific = productDiscount({
            priceScope: 'specific_price_books',
            priceBookIds: ['wholesale-book']
        })

        expect(resolve([specific], 'wholesale-book', 75)).toMatchObject({ source: 'product', discountPrice: 67.5 })
        expect(resolve([specific], 'retail-book')?.source).toBe('category')
    })

    it('does not apply a fixed rule to a price source in another currency', () => {
        const fixedUsd = productDiscount({
            discountType: 'fixed_amount',
            discountValue: 10,
            discountCurrency: 'usd'
        })

        expect(resolve([fixedUsd], 'iqd-book', 100000, 'iqd')?.source).toBe('category')
    })
})
