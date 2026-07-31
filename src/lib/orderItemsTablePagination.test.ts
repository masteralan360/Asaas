import { describe, expect, it } from 'vitest'
import {
    findOrderItemsSplitIndex,
    ORDER_ITEMS_CONTINUATION_ATTR,
    ORDER_ITEMS_PAGINATED_ATTR
} from './orderItemsTablePagination'

function row(topMm: number, heightMm = 8): { topMm: number; bottomMm: number } {
    return { topMm, bottomMm: topMm + heightMm }
}

describe('findOrderItemsSplitIndex', () => {
    it('returns null when the table fits within a single page', () => {
        const rows = [row(10), row(18), row(26), row(34)]
        expect(findOrderItemsSplitIndex(rows, 297)).toBeNull()
    })

    it('cuts right above the first row that crosses the red line', () => {
        // Boundary at 297mm; the row at 292mm (bottom 300mm) is the first to cross.
        const rows = [row(120), row(128), row(136), row(144), row(292)]
        expect(findOrderItemsSplitIndex(rows, 297)).toEqual({ rowIndex: 4, boundaryMm: 297 })
    })

    it('keeps a row that ends exactly at the boundary on the previous page', () => {
        const rows = [row(120), row(128), row(289), row(297)]
        expect(findOrderItemsSplitIndex(rows, 297)).toEqual({ rowIndex: 3, boundaryMm: 297 })
    })

    it('handles tables that span several pages by returning the first crossing', () => {
        const rows = [row(10), row(18), row(290), row(298), row(306), row(580), row(588)]
        expect(findOrderItemsSplitIndex(rows, 297)).toEqual({ rowIndex: 2, boundaryMm: 297 })
    })

    it('does not split when the very first row already crosses the line', () => {
        const rows = [row(295), row(303), row(311), row(500)]
        expect(findOrderItemsSplitIndex(rows, 297)).toBeNull()
    })

    it('splits on later boundaries when the table starts after the first page', () => {
        const rows = [row(298), row(306), row(314), row(590), row(598)]
        expect(findOrderItemsSplitIndex(rows, 297)).toEqual({ rowIndex: 3, boundaryMm: 594 })
    })

    it('returns null for an empty table or an invalid page height', () => {
        expect(findOrderItemsSplitIndex([], 297)).toBeNull()
        expect(findOrderItemsSplitIndex([row(10)], 0)).toBeNull()
        expect(findOrderItemsSplitIndex([row(10)], Number.NaN)).toBeNull()
    })
})

describe('order items pagination markers', () => {
    it('exposes the attribute names the template and paginator agree on', () => {
        expect(ORDER_ITEMS_PAGINATED_ATTR).toBe('data-order-items-paginated')
        expect(ORDER_ITEMS_CONTINUATION_ATTR).toBe('data-order-items-continuation')
    })
})
