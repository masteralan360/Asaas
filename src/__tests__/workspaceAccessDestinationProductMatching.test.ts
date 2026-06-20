import { describe, expect, it } from 'vitest'
import { buildDestinationProductMatchIndex } from '../../supabase/functions/workspace-access/destinationProductMatching'

type ProductRow = {
    id: string
    sku: string
    is_deleted: boolean
    updated_at: string
}

describe('buildDestinationProductMatchIndex', () => {
    it('reuses a soft-deleted destination product when no active match exists', () => {
        const deletedProduct: ProductRow = {
            id: 'deleted-product',
            sku: 'Product40',
            is_deleted: true,
            updated_at: '2026-06-20T10:00:00.000Z'
        }

        const result = buildDestinationProductMatchIndex([deletedProduct])

        expect(result.productBySku.get('product40')).toBe(deletedProduct)
        expect(result.duplicateActiveSkus.size).toBe(0)
    })

    it('prefers an active destination product over a deleted historical match', () => {
        const deletedProduct: ProductRow = {
            id: 'deleted-product',
            sku: 'PRODUCT40',
            is_deleted: true,
            updated_at: '2026-06-20T11:00:00.000Z'
        }
        const activeProduct: ProductRow = {
            id: 'active-product',
            sku: 'Product40',
            is_deleted: false,
            updated_at: '2026-06-20T10:00:00.000Z'
        }

        const result = buildDestinationProductMatchIndex([deletedProduct, activeProduct])

        expect(result.productBySku.get('product40')).toBe(activeProduct)
        expect(result.duplicateActiveSkus.size).toBe(0)
    })

    it('uses the most recently deleted product when historical duplicates exist', () => {
        const olderProduct: ProductRow = {
            id: 'older-product',
            sku: 'Product40',
            is_deleted: true,
            updated_at: '2026-06-19T10:00:00.000Z'
        }
        const newerProduct: ProductRow = {
            id: 'newer-product',
            sku: 'Product40',
            is_deleted: true,
            updated_at: '2026-06-20T10:00:00.000Z'
        }

        const result = buildDestinationProductMatchIndex([olderProduct, newerProduct])

        expect(result.productBySku.get('product40')).toBe(newerProduct)
        expect(result.duplicateActiveSkus.size).toBe(0)
    })

    it('reports duplicate active products for the same normalized SKU', () => {
        const result = buildDestinationProductMatchIndex([
            {
                id: 'first-product',
                sku: 'Product40',
                is_deleted: false,
                updated_at: '2026-06-20T10:00:00.000Z'
            },
            {
                id: 'second-product',
                sku: ' product40 ',
                is_deleted: false,
                updated_at: '2026-06-20T11:00:00.000Z'
            }
        ])

        expect(result.duplicateActiveSkus).toEqual(new Set(['product40']))
    })
})
