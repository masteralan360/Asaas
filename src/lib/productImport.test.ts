import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
    PRODUCT_IMPORT_FIELDS,
    REQUIRED_PRODUCT_IMPORT_HEADERS,
    assignGeneratedProductImportSkus,
    createProductImportPreviewRows,
    parseProductImportWorkbook,
    parseProductImportMatrix,
    revalidateProductImportRow,
    type ProductImportValidationContext
} from './productImport'

const context: ProductImportValidationContext = {
    categories: [{ id: 'category-a', name: 'مواد البناء' }],
    storages: [{ id: 'storage-a', name: 'Main storage' }],
    allowedCurrencies: ['usd', 'iqd']
}

function validProductRow(
    overrides: Partial<Record<(typeof PRODUCT_IMPORT_FIELDS)[number], string | number>> = {},
    headers: readonly string[] = REQUIRED_PRODUCT_IMPORT_HEADERS
) {
    return headers.map((field) => ({
        sku: '',
        name: 'بوري تأسيس',
        category_id: 'category-a',
        category: 'مواد البناء',
        storage_id: 'storage-a',
        price: 0,
        cost_price: 0,
        quantity: 0,
        min_stock_level: 0,
        unit: 'pcs',
        Currency: 'USD',
        ...overrides
    })[field as keyof Record<(typeof PRODUCT_IMPORT_FIELDS)[number], string | number>])
}

describe('product import parsing and validation', () => {
    it('finds a header below an empty row and keeps zero numeric values valid', () => {
        const parsed = parseProductImportMatrix([
            [...REQUIRED_PRODUCT_IMPORT_HEADERS],
            validProductRow(),
            []
        ], 1)
        const previewRows = createProductImportPreviewRows(assignGeneratedProductImportSkus(parsed.rows, []), context)

        expect(parsed.headerRowNumber).toBe(2)
        expect(parsed.fileErrors).toEqual([])
        expect(previewRows).toHaveLength(2)
        expect(previewRows[0].excelRowNumber).toBe(3)
        expect(previewRows[0].values.price).toBe('0')
        expect(previewRows[0].isValid).toBe(true)
        expect(previewRows[1].excelRowNumber).toBe(4)
        expect(previewRows[1].isValid).toBe(false)
        expect(previewRows[1].errors.some((error) => error.field === 'row')).toBe(true)
    })

    it('preserves Excel row numbers when the workbook starts with an empty row', async () => {
        const workbook = XLSX.utils.book_new()
        const worksheet = XLSX.utils.aoa_to_sheet([[], [...REQUIRED_PRODUCT_IMPORT_HEADERS], validProductRow()])
        // Empty leading cells are not included in the generated !ref, so retain the physical Excel row.
        worksheet['!ref'] = 'A1:J3'
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products')

        const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
        const parsed = await parseProductImportWorkbook(workbookData)

        expect(parsed.headerRowNumber).toBe(2)
        expect(parsed.rows[0].excelRowNumber).toBe(3)
    })

    it('assigns sequential numeric SKUs without changing the original parsed row', () => {
        const parsed = parseProductImportMatrix([
            [...REQUIRED_PRODUCT_IMPORT_HEADERS],
            validProductRow(),
            validProductRow({ name: 'Product two' })
        ])
        const assignedRows = assignGeneratedProductImportSkus(parsed.rows, ['100000'])

        expect(assignedRows.map((row) => row.values.sku)).toEqual(['100001', '100002'])
        expect(assignedRows.map((row) => row.originalValues.sku)).toEqual(['', ''])
        expect(parsed.rows.map((row) => row.values.sku)).toEqual(['', ''])
    })

    it('reports duplicate headers and mismatched category pairs', () => {
        const parsed = parseProductImportMatrix([
            [...REQUIRED_PRODUCT_IMPORT_HEADERS, 'name'],
            validProductRow({ category: 'مواد مختلفة' })
        ])
        const previewRows = createProductImportPreviewRows(assignGeneratedProductImportSkus(parsed.rows, []), context)

        expect(parsed.fileErrors.map((error) => error.message)).toContain('Duplicate header: name.')
        expect(previewRows[0].isValid).toBe(false)
        expect(previewRows[0].errors).toContainEqual(expect.objectContaining({ field: 'category' }))
    })

    it('revalidates an editable copy without changing the original parsed row', () => {
        const parsed = parseProductImportMatrix([
            [...REQUIRED_PRODUCT_IMPORT_HEADERS],
            validProductRow()
        ])
        const [previewRow] = createProductImportPreviewRows(assignGeneratedProductImportSkus(parsed.rows, []), context)
        const revalidated = revalidateProductImportRow({
            ...previewRow,
            values: { ...previewRow.values, price: 'not a number' }
        }, context)

        expect(previewRow.values.price).toBe('0')
        expect(revalidated.values.price).toBe('not a number')
        expect(revalidated.errors).toContainEqual(expect.objectContaining({ field: 'price' }))
    })
})
