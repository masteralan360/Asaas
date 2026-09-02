import { describe, expect, it } from 'vitest'

import {
    buildExportPreviewTable,
    buildProductExportPrintTableChunks,
    clearExportPreviewColumnRows,
    deleteExportPreviewColumn,
    exportPreviewTableToRows,
    PRODUCT_EXPORT_PRINT_MAX_COLUMNS,
    PRODUCT_EXPORT_PRINT_MAX_ROWS,
    remapSelectedPrintColumnsAfterDeletion,
    selectExportPreviewTableColumns,
    shouldUseSingleLineProductExportRows
} from './productExportPrintTable'

describe('product export print table', () => {
    it('keeps active columns and excludes preview rows deleted to empty cells', () => {
        const table = buildExportPreviewTable([
            [{ value: 'SKU' }, { value: 'Name' }, { value: '' }],
            [{ value: '001' }, { value: 'Chocolate' }, { value: 'not exported' }],
            [{ value: '' }, { value: '' }, { value: '' }],
            [{ value: 0 }, { value: 'Free sample' }, { value: '' }]
        ])

        expect(table).toEqual({
            columns: ['SKU', 'Name'],
            rows: [
                ['001', 'Chocolate'],
                [0, 'Free sample']
            ]
        })
        expect(exportPreviewTableToRows(table)).toEqual([
            { SKU: '001', Name: 'Chocolate' },
            { SKU: 0, Name: 'Free sample' }
        ])
    })

    it('splits a wide export into bounded A4-friendly column and row chunks', () => {
        const chunks = buildProductExportPrintTableChunks({
            columns: ['A', 'B', 'C', 'D', 'E'],
            rows: [
                [1, 2, 3, 4, 5],
                [6, 7, 8, 9, 10],
                [11, 12, 13, 14, 15]
            ]
        }, 2, 2)

        expect(chunks).toEqual([
            { columnStart: 0, columns: ['A', 'B'], rows: [[1, 2], [6, 7]] },
            { columnStart: 0, columns: ['A', 'B'], rows: [[11, 12]] },
            { columnStart: 2, columns: ['C', 'D'], rows: [[3, 4], [8, 9]] },
            { columnStart: 2, columns: ['C', 'D'], rows: [[13, 14]] },
            { columnStart: 4, columns: ['E'], rows: [[5], [10]] },
            { columnStart: 4, columns: ['E'], rows: [[15]] }
        ])
    })

    it('keeps 30 spreadsheet rows in each complete A4 table block', () => {
        const rows = Array.from({ length: PRODUCT_EXPORT_PRINT_MAX_ROWS + 1 }, (_, index) => [index + 1])
        const chunks = buildProductExportPrintTableChunks({ columns: ['SKU'], rows })

        expect(PRODUCT_EXPORT_PRINT_MAX_ROWS).toBe(30)
        expect(chunks).toEqual([
            { columnStart: 0, columns: ['SKU'], rows: rows.slice(0, 30) },
            { columnStart: 0, columns: ['SKU'], rows: rows.slice(30) }
        ])
    })

    it('keeps all twelve product export columns in the same print table', () => {
        const columns = Array.from({ length: PRODUCT_EXPORT_PRINT_MAX_COLUMNS }, (_, index) => `Column ${index + 1}`)
        const chunks = buildProductExportPrintTableChunks({
            columns,
            rows: [columns.map((_, index) => index + 1)]
        })

        expect(PRODUCT_EXPORT_PRINT_MAX_COLUMNS).toBe(12)
        expect(chunks).toEqual([{
            columnStart: 0,
            columns,
            rows: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]
        }])
    })

    it('uses single-line table cells only when more than six columns are printed', () => {
        expect(shouldUseSingleLineProductExportRows(6)).toBe(false)
        expect(shouldUseSingleLineProductExportRows(7)).toBe(true)
        expect(shouldUseSingleLineProductExportRows(12)).toBe(true)
    })

    it('clears a selected preview column without removing its header', () => {
        const matrix = [
            [{ value: 'SKU' }, { value: 'Name' }],
            [{ value: '001' }, { value: 'Chocolate' }],
            [{ value: '002' }, { value: 'Coffee' }]
        ]

        expect(clearExportPreviewColumnRows(matrix, 1)).toEqual([
            [{ value: 'SKU' }, { value: 'Name' }],
            [{ value: '001' }, { value: '' }],
            [{ value: '002' }, { value: '' }]
        ])
    })

    it('deletes a selected preview column from its header and every row', () => {
        const matrix = [
            [{ value: 'SKU' }, { value: 'Name' }],
            [{ value: '001' }, { value: 'Chocolate' }]
        ]

        expect(deleteExportPreviewColumn(matrix, 0)).toEqual([
            [{ value: 'Name' }],
            [{ value: 'Chocolate' }]
        ])
    })

    it('builds print data only from explicitly checked columns', () => {
        const printedTable = selectExportPreviewTableColumns({
            columns: ['SKU', 'Name', 'Stock'],
            rows: [
                ['001', 'Chocolate', 12],
                ['002', 'Coffee', 0],
                ['003', 'Hidden', '']
            ]
        }, new Set([0, 2]))

        expect(printedTable).toEqual({
            columns: ['SKU', 'Stock'],
            rows: [
                ['001', 12],
                ['002', 0],
                ['003', '']
            ]
        })
    })

    it('remaps checked print columns after a preview column is deleted', () => {
        expect(remapSelectedPrintColumnsAfterDeletion(new Set([1, 3, 5]), 3)).toEqual(new Set([1, 4]))
    })
})
