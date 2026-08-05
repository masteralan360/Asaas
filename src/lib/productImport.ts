import type { Category, CurrencyCode, Storage } from '@/local-db/models'
import { normalizeUnitCode } from '@/local-db/models'

export const REQUIRED_PRODUCT_IMPORT_HEADERS = [
    'name',
    'category_id',
    'category',
    'storage_id',
    'price',
    'cost_price',
    'quantity',
    'min_stock_level',
    'unit',
    'Currency'
] as const

/** sku/SKU is optional in the workbook; blank values receive a generated numeric SKU. */
export const PRODUCT_IMPORT_FIELDS = [
    'sku',
    ...REQUIRED_PRODUCT_IMPORT_HEADERS
] as const

export type ProductImportField = typeof PRODUCT_IMPORT_FIELDS[number]

export type ProductImportValues = Record<ProductImportField, string>

export interface ProductImportFileError {
    message: string
}

export interface ProductImportValidationError {
    field: ProductImportField | 'row'
    message: string
}

export interface ParsedProductImportRow {
    excelRowNumber: number
    /** Values exactly as read from the worksheet, normalized only for whitespace. */
    originalValues: ProductImportValues
    /** A separate copy that is safe for the preview to edit. */
    values: ProductImportValues
}

export interface ProductImportPreviewRow extends ParsedProductImportRow {
    errors: ProductImportValidationError[]
    isValid: boolean
}

export interface ProductImportParseResult {
    headerRowNumber: number | null
    rows: ParsedProductImportRow[]
    fileErrors: ProductImportFileError[]
}

export interface ProductImportValidationContext {
    categories: Pick<Category, 'id' | 'name'>[]
    storages: Pick<Storage, 'id' | 'name'>[]
    allowedCurrencies: CurrencyCode[]
}

export interface ProductImportBackendFailure {
    excelRowNumber: number
    message: string
}

export interface ProductImportSubmissionResult {
    importedRowNumbers: number[]
    failures: ProductImportBackendFailure[]
}

export interface ProductImportProgress {
    totalRows: number
    completedRows: number
    importedRows: number
    failedRows: number
    currentExcelRowNumber: number | null
}

const REQUIRED_VALUE_FIELDS: ProductImportField[] = [
    'name',
    'storage_id',
    'price',
    'quantity',
    'unit',
    'Currency'
]

const NUMERIC_FIELDS: ProductImportField[] = [
    'price',
    'cost_price',
    'quantity',
    'min_stock_level'
]

function isProductImportField(value: string): value is ProductImportField {
    return (PRODUCT_IMPORT_FIELDS as readonly string[]).includes(value)
}

function getProductImportFieldForHeader(header: string): ProductImportField | null {
    if (header === 'SKU' || header === 'sku') {
        return 'sku'
    }

    return isProductImportField(header) ? header : null
}

function createEmptyValues(): ProductImportValues {
    return {
        sku: '',
        name: '',
        category_id: '',
        category: '',
        storage_id: '',
        price: '',
        cost_price: '',
        quantity: '',
        min_stock_level: '',
        unit: '',
        Currency: ''
    }
}

function asTrimmedText(value: unknown): string {
    if (value === null || value === undefined) {
        return ''
    }

    return String(value).trim()
}

function isEmptyWorksheetRow(row: unknown[]): boolean {
    return row.every((value) => asTrimmedText(value) === '')
}

function addError(errors: ProductImportValidationError[], field: ProductImportValidationError['field'], message: string) {
    errors.push({ field, message })
}

function findHeaderRowIndex(matrix: unknown[][]) {
    const nonEmptyRows = matrix
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !isEmptyWorksheetRow(row))

    const completeHeader = nonEmptyRows.find(({ row }) => {
        const values = new Set(row.map(asTrimmedText))
        return REQUIRED_PRODUCT_IMPORT_HEADERS.every((field) => values.has(field))
    })

    if (completeHeader) {
        return completeHeader.index
    }

    const partialHeader = nonEmptyRows.find(({ row }) =>
        row.some((value) => getProductImportFieldForHeader(asTrimmedText(value)) !== null)
    )

    return partialHeader?.index ?? nonEmptyRows[0]?.index ?? null
}

/**
 * Parses a worksheet matrix into editable import rows. This stays independent
 * from XLSX so it can be tested without a file reader.
 */
export function parseProductImportMatrix(matrix: unknown[][], excelRowOffset = 0): ProductImportParseResult {
    if (matrix.length === 0 || matrix.every(isEmptyWorksheetRow)) {
        return {
            headerRowNumber: null,
            rows: [],
            fileErrors: [{ message: 'The workbook is empty. Add the required header row and at least one product row.' }]
        }
    }

    const headerIndex = findHeaderRowIndex(matrix)
    if (headerIndex === null) {
        return {
            headerRowNumber: null,
            rows: [],
            fileErrors: [{ message: 'A non-empty header row could not be found.' }]
        }
    }

    const headerRow = matrix[headerIndex] ?? []
    const headers = headerRow.map(asTrimmedText)
    const fileErrors: ProductImportFileError[] = []
    const headerIndexes = new Map<ProductImportField, number>()
    const duplicateHeaders = new Set<string>()
    const seenHeaders = new Set<string>()

    headers.forEach((header, index) => {
        if (!header) {
            return
        }

        if (seenHeaders.has(header)) {
            duplicateHeaders.add(header)
            return
        }

        seenHeaders.add(header)
        const field = getProductImportFieldForHeader(header)
        if (field) {
            if (headerIndexes.has(field)) {
                duplicateHeaders.add(field)
                return
            }
            headerIndexes.set(field, index)
        }
    })

    const missingHeaders = REQUIRED_PRODUCT_IMPORT_HEADERS.filter((field) => !headerIndexes.has(field))
    if (missingHeaders.length > 0) {
        fileErrors.push({
            message: `Missing required header${missingHeaders.length === 1 ? '' : 's'}: ${missingHeaders.join(', ')}.`
        })
    }

    if (duplicateHeaders.size > 0) {
        fileErrors.push({
            message: `Duplicate header${duplicateHeaders.size === 1 ? '' : 's'}: ${Array.from(duplicateHeaders).join(', ')}.`
        })
    }

    const rows = matrix.slice(headerIndex + 1).map((worksheetRow, index) => {
        const values = createEmptyValues()
        for (const field of PRODUCT_IMPORT_FIELDS) {
            const columnIndex = headerIndexes.get(field)
            const rawValue = columnIndex === undefined ? '' : asTrimmedText(worksheetRow[columnIndex])
            values[field] = field === 'unit' ? normalizeUnitCode(rawValue) : rawValue
        }

        return {
            excelRowNumber: excelRowOffset + headerIndex + index + 2,
            originalValues: { ...values },
            values: { ...values }
        }
    })

    if (rows.length === 0) {
        fileErrors.push({ message: 'No product rows were found below the header row.' })
    }

    return {
        headerRowNumber: excelRowOffset + headerIndex + 1,
        rows,
        fileErrors
    }
}

/** Reads the first worksheet in an .xlsx file and parses it without writing to the source file. */
export async function parseProductImportWorkbook(file: ArrayBuffer): Promise<ProductImportParseResult> {
    if (file.byteLength === 0) {
        throw new Error('The selected file is empty.')
    }

    const XLSX = await import('xlsx')
    let workbook: ReturnType<typeof XLSX.read>

    try {
        workbook = XLSX.read(file, { type: 'array', cellDates: false, raw: true })
    } catch (error) {
        console.error('[Products] Excel workbook parsing failed:', error)
        throw new Error('The Excel file could not be read. It may be corrupted, password-protected, or not an .xlsx workbook.')
    }

    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
        throw new Error('The workbook does not contain a readable worksheet.')
    }

    const worksheet = workbook.Sheets[firstSheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: '',
        raw: true,
        blankrows: true
    })

    const worksheetRange = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null

    return parseProductImportMatrix(matrix, worksheetRange?.s.r ?? 0)
}

function normalizeSku(value: string) {
    return value.trim().toLowerCase()
}

function hasProductValues(row: Pick<ParsedProductImportRow, 'values'>) {
    return REQUIRED_PRODUCT_IMPORT_HEADERS.some((field) => row.values[field] !== '')
}

/**
 * Generates sequential numeric SKUs for rows whose workbook has no sku/SKU
 * value. The original parsed values remain untouched for auditability.
 */
export function assignGeneratedProductImportSkus(
    rows: ParsedProductImportRow[],
    existingSkus: Array<string | null | undefined>
): ParsedProductImportRow[] {
    const usedSkuKeys = new Set<string>()
    let highestNumericSku = 99999n

    const reserveSku = (sku: string) => {
        const normalized = normalizeSku(sku)
        if (!normalized) {
            return
        }

        usedSkuKeys.add(normalized)
        if (/^\d+$/.test(normalized)) {
            const numericSku = BigInt(normalized)
            if (numericSku > highestNumericSku) {
                highestNumericSku = numericSku
            }
        }
    }

    for (const sku of existingSkus) {
        reserveSku(sku ?? '')
    }
    for (const row of rows) {
        reserveSku(row.values.sku)
    }

    let nextNumericSku = highestNumericSku + 1n
    const nextAvailableSku = () => {
        while (usedSkuKeys.has(nextNumericSku.toString())) {
            nextNumericSku += 1n
        }

        const sku = nextNumericSku.toString()
        usedSkuKeys.add(sku)
        nextNumericSku += 1n
        return sku
    }

    return rows.map((row) => {
        const originalValues = { ...row.originalValues }
        const values = { ...row.values }
        if (values.sku === '' && hasProductValues(row)) {
            values.sku = nextAvailableSku()
        }

        return {
            excelRowNumber: row.excelRowNumber,
            originalValues,
            values
        }
    })
}

export function revalidateProductImportRow(
    row: Pick<ProductImportPreviewRow, 'excelRowNumber' | 'originalValues' | 'values'>,
    context: ProductImportValidationContext
): ProductImportPreviewRow {
    const values = Object.fromEntries(
        PRODUCT_IMPORT_FIELDS.map((field) => [field, asTrimmedText(row.values[field])])
    ) as ProductImportValues
    const errors: ProductImportValidationError[] = []

    const isCompletelyEmpty = REQUIRED_PRODUCT_IMPORT_HEADERS.every((field) => values[field] === '')
    if (isCompletelyEmpty) {
        addError(errors, 'row', 'This row is completely empty and cannot be imported.')
    }

    if (!isCompletelyEmpty && values.sku === '') {
        addError(errors, 'sku', 'SKU is required. It is generated automatically when the preview opens.')
    }

    for (const field of REQUIRED_VALUE_FIELDS) {
        if (values[field] === '') {
            addError(errors, field, `${field} is required.`)
        }
    }

    for (const field of NUMERIC_FIELDS) {
        const value = values[field]
        if (value === '') {
            if (field !== 'min_stock_level') {
                continue
            }
            continue
        }

        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
            addError(errors, field, `${field} must be a valid number.`)
        } else if (parsed < 0) {
            addError(errors, field, `${field} cannot be negative.`)
        }
    }

    if (values.storage_id !== '' && !context.storages.some((storage) => storage.id === values.storage_id)) {
        addError(errors, 'storage_id', 'storage_id does not match an existing storage location.')
    }

    const hasCategoryId = values.category_id !== ''
    const hasCategoryName = values.category !== ''
    if (hasCategoryId !== hasCategoryName) {
        const missingField: ProductImportField = hasCategoryId ? 'category' : 'category_id'
        addError(errors, missingField, 'category_id and category must be provided together when either one is used.')
    } else if (hasCategoryId && hasCategoryName) {
        const matchingCategory = context.categories.find((category) => category.id === values.category_id)
        if (!matchingCategory) {
            addError(errors, 'category_id', 'category_id does not match an existing category.')
        } else if (matchingCategory.name.trim() !== values.category) {
            addError(errors, 'category', `category does not match category_id ${values.category_id}. Expected "${matchingCategory.name}".`)
        }
    }

    if (values.Currency !== '') {
        const normalizedCurrency = values.Currency.toLowerCase()
        if (!context.allowedCurrencies.includes(normalizedCurrency as CurrencyCode)) {
            addError(errors, 'Currency', `Currency "${values.Currency}" is not available in this workspace.`)
        }
    }

    return {
        excelRowNumber: row.excelRowNumber,
        originalValues: { ...row.originalValues },
        values,
        errors,
        isValid: errors.length === 0
    }
}

export function createProductImportPreviewRows(
    rows: ParsedProductImportRow[],
    context: ProductImportValidationContext
): ProductImportPreviewRow[] {
    return revalidateProductImportRows(rows, context)
}

export function revalidateProductImportRows(
    rows: Array<Pick<ProductImportPreviewRow, 'excelRowNumber' | 'originalValues' | 'values'>>,
    context: ProductImportValidationContext
): ProductImportPreviewRow[] {
    const revalidatedRows = rows.map((row) => revalidateProductImportRow(row, context))
    const skuCounts = new Map<string, number>()

    for (const row of revalidatedRows) {
        const sku = normalizeSku(row.values.sku)
        if (sku) {
            skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1)
        }
    }

    return revalidatedRows.map((row) => {
        const sku = normalizeSku(row.values.sku)
        if (!sku || skuCounts.get(sku) === 1) {
            return row
        }

        const errors = [
            ...row.errors,
            { field: 'sku' as const, message: `SKU "${row.values.sku}" is duplicated in this import.` }
        ]
        return { ...row, errors, isValid: false }
    })
}
