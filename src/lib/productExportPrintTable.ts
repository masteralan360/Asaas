export type ExportPreviewCell = {
    value?: unknown
} | undefined

export type ExportPreviewTable = {
    columns: string[]
    rows: unknown[][]
}

export type ProductExportPrintTableChunk = {
    columnStart: number
    columns: string[]
    rows: unknown[][]
}

export const PRODUCT_EXPORT_PRINT_MAX_COLUMNS = 12
export const PRODUCT_EXPORT_PRINT_MAX_ROWS = 30

export function shouldUseSingleLineProductExportRows(columnCount: number) {
    return columnCount > 6
}

/**
 * Clears the data cells in one preview column while keeping its header. This
 * lets an export retain its shape when a user needs a blank column in Excel.
 */
export function clearExportPreviewColumnRows<Cell extends ExportPreviewCell>(
    matrix: readonly (readonly Cell[])[],
    columnIndex: number
): Cell[][] {
    if (columnIndex < 0) {
        return matrix.map((row) => [...row])
    }

    return matrix.map((row, rowIndex) => {
        if (rowIndex === 0 || columnIndex >= row.length) {
            return [...row]
        }

        return row.map((cell, index) => (
            index === columnIndex
                ? { ...cell, value: '' } as Cell
                : cell
        ))
    })
}

/** Removes a preview column, including its header, from every row. */
export function deleteExportPreviewColumn<Cell extends ExportPreviewCell>(
    matrix: readonly (readonly Cell[])[],
    columnIndex: number
): Cell[][] {
    if (columnIndex < 0) {
        return matrix.map((row) => [...row])
    }

    return matrix.map((row) => row.filter((_, index) => index !== columnIndex))
}

/**
 * Builds the print-only view from explicitly selected preview columns. Excel
 * export keeps using the complete editable preview, so printing no longer
 * depends on deleting columns first.
 */
export function selectExportPreviewTableColumns(
    table: ExportPreviewTable,
    selectedColumnIndexes: ReadonlySet<number>
): ExportPreviewTable {
    const selectedIndexes = table.columns
        .map((_, index) => index)
        .filter((index) => selectedColumnIndexes.has(index))

    return {
        columns: selectedIndexes.map((index) => table.columns[index]),
        rows: table.rows
            .map((row) => selectedIndexes.map((index) => row[index] ?? ''))
            .filter((row) => row.some((value) => !isEmptyExportValue(value)))
    }
}

/** Keeps selected print-column indices accurate when a preview column is removed. */
export function remapSelectedPrintColumnsAfterDeletion(
    selectedColumnIndexes: ReadonlySet<number>,
    deletedColumnIndex: number
) {
    return new Set(
        [...selectedColumnIndexes]
            .filter((index) => index !== deletedColumnIndex)
            .map((index) => index > deletedColumnIndex ? index - 1 : index)
    )
}

function isEmptyExportValue(value: unknown) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0)
}

/**
 * Creates the canonical table used by both Excel download and A4 printing.
 * Empty rows are intentionally excluded so row deletion in the preview is
 * reflected in every output.
 */
export function buildExportPreviewTable(matrix: readonly (readonly ExportPreviewCell[])[]): ExportPreviewTable {
    const headerRow = matrix[0] || []
    const activeColumns = headerRow
        .map((cell, index) => ({ header: String(cell?.value ?? '').trim(), index }))
        .filter(({ header }) => header.length > 0)

    if (activeColumns.length === 0) {
        return { columns: [], rows: [] }
    }

    const rows = matrix.slice(1)
        .map((row) => activeColumns.map(({ index }) => row?.[index]?.value ?? ''))
        .filter((row) => row.some((value) => !isEmptyExportValue(value)))

    return {
        columns: activeColumns.map(({ header }) => header),
        rows
    }
}

export function exportPreviewTableToRows(table: ExportPreviewTable) {
    return table.rows.map((row) => Object.fromEntries(
        table.columns.map((column, index) => [column, row[index] ?? ''])
    ))
}

/**
 * Splits a spreadsheet-sized product export into readable A4 table chunks.
 * The product export has up to 12 columns, so each printed table preserves the
 * user's current preview columns together. Each table holds at most 30 rows so
 * the shared A4 paginator can move it as one complete block to the next page
 * rather than splitting its header or a data row.
 */
export function buildProductExportPrintTableChunks(
    table: ExportPreviewTable,
    maxColumns = PRODUCT_EXPORT_PRINT_MAX_COLUMNS,
    maxRows = PRODUCT_EXPORT_PRINT_MAX_ROWS
): ProductExportPrintTableChunk[] {
    const safeMaxColumns = Math.max(1, Math.floor(maxColumns))
    const safeMaxRows = Math.max(1, Math.floor(maxRows))
    const chunks: ProductExportPrintTableChunk[] = []

    for (let columnStart = 0; columnStart < table.columns.length; columnStart += safeMaxColumns) {
        const columns = table.columns.slice(columnStart, columnStart + safeMaxColumns)
        for (let rowStart = 0; rowStart < table.rows.length; rowStart += safeMaxRows) {
            chunks.push({
                columnStart,
                columns,
                rows: table.rows
                    .slice(rowStart, rowStart + safeMaxRows)
                    .map((row) => row.slice(columnStart, columnStart + safeMaxColumns))
            })
        }
    }

    return chunks
}
