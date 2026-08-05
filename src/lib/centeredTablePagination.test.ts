import { describe, expect, it } from 'vitest'
import {
    CENTERED_TABLE_ATTR,
    CENTERED_TABLE_SPACER_ATTR,
    planCenteredTableSpacers
} from './centeredTablePagination'

const PAGE = 297

describe('planCenteredTableSpacers', () => {
    it('centers a table that crosses the first page boundary on page 2', () => {
        // 161mm table naturally starting at 260mm crosses the 297mm line; it
        // must be centered on page 2: 297 + (297 - 161) / 2 = 365mm.
        expect(planCenteredTableSpacers([260], [161], PAGE)).toEqual([
            { tableIndex: 0, spacerMm: 105 }
        ])
    })

    it('centers a table that already starts on page 2 within that page', () => {
        expect(planCenteredTableSpacers([320], [161], PAGE)).toEqual([
            { tableIndex: 0, spacerMm: 45 }
        ])
    })

    it('leaves a table untouched when it is already below its centering target', () => {
        expect(planCenteredTableSpacers([700], [100], PAGE)).toEqual([])
    })

    it('centers every continuation table on its own page with a running shift', () => {
        const placements = planCenteredTableSpacers([260, 421], [161, 161], PAGE)
        expect(placements).toEqual([
            { tableIndex: 0, spacerMm: 105 },
            { tableIndex: 1, spacerMm: 136 }
        ])
        // Table 0 ends at 365 + 161 = 526; table 1 lands at 662, centered on page 3.
        expect(662 % PAGE).toBeCloseTo((PAGE - 161) / 2)
    })

    it('centers a table fully contained in one page on that same page', () => {
        expect(planCenteredTableSpacers([80], [100], PAGE)).toEqual([
            { tableIndex: 0, spacerMm: (PAGE - 100) / 2 - 80 }
        ])
    })

    it('returns no placements for empty or mismatched input', () => {
        expect(planCenteredTableSpacers([], [], PAGE)).toEqual([])
        expect(planCenteredTableSpacers([100], [], PAGE)).toEqual([])
        expect(planCenteredTableSpacers([100], [80], 0)).toEqual([])
        expect(planCenteredTableSpacers([Number.NaN], [80], PAGE)).toEqual([])
    })
})

describe('centered table pagination markers', () => {
    it('exposes the attribute names the template and paginator agree on', () => {
        expect(CENTERED_TABLE_ATTR).toBe('data-centered-table')
        expect(CENTERED_TABLE_SPACER_ATTR).toBe('data-centered-table-spacer')
    })
})
