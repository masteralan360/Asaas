import { describe, expect, it } from 'vitest'

import type { PriceBook, PriceBookItem } from '@/local-db/models'
import { findPartnerProductPriceBookItem } from './priceBooks'

const metadata = {
    workspaceId: 'workspace-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    syncStatus: 'synced' as const,
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    isDeleted: false
}

const priceBook: PriceBook = {
    ...metadata,
    id: 'book-1',
    name: 'Wholesale'
}

const priceBookItem: PriceBookItem = {
    ...metadata,
    id: 'item-1',
    priceBookId: priceBook.id,
    productId: 'product-1',
    costPrice: 0,
    price: 0,
    currency: 'usd'
}

describe('findPartnerProductPriceBookItem', () => {
    it('returns the exact matching item and preserves zero-valued overrides', () => {
        expect(findPartnerProductPriceBookItem(
            true,
            { priceBookId: priceBook.id },
            'product-1',
            [priceBook],
            [priceBookItem]
        )).toEqual(priceBookItem)
    })

    it('does not expose cached pricing while the capability is disabled', () => {
        expect(findPartnerProductPriceBookItem(
            false,
            { priceBookId: priceBook.id },
            'product-1',
            [priceBook],
            [priceBookItem]
        )).toBeUndefined()
    })

    it('requires an active assigned book and an exact product mapping', () => {
        expect(findPartnerProductPriceBookItem(
            true,
            { priceBookId: 'book-2' },
            'product-1',
            [priceBook],
            [priceBookItem]
        )).toBeUndefined()

        expect(findPartnerProductPriceBookItem(
            true,
            { priceBookId: priceBook.id },
            'product-2',
            [priceBook],
            [priceBookItem]
        )).toBeUndefined()

        expect(findPartnerProductPriceBookItem(
            true,
            { priceBookId: priceBook.id },
            'product-1',
            [{ ...priceBook, isDeleted: true }],
            [priceBookItem]
        )).toBeUndefined()
    })
})
