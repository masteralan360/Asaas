/**
 * Paginates statement tables (partner order items) across A4 page boundaries.
 *
 * The template renders the sales/purchase statement as one continuous flow that
 * the PDF pipeline slices at every `pageHeightMm` (the preview "red line").
 * When a table would cross that line, this splits the table right at the line:
 * rows above it keep their original header, while the rest moves into a new
 * chunk table that repeats the section title ("… (continued)") and the column
 * header row, so the second page reads as a clear continuation of its parent
 * section.
 *
 * The same DOM routine is used by the PDF preview (`PdfPreviewPage`) and by the
 * canvas→PDF generator (`pdfGenerator`), which keeps the on-screen preview and
 * the exported document in sync.
 */

export const ORDER_ITEMS_PAGINATED_ATTR = 'data-order-items-paginated'
export const ORDER_ITEMS_SECTION_ATTR = 'data-order-items-section'
export const ORDER_ITEMS_TITLE_BAR_ATTR = 'data-order-items-section-title-bar'
export const ORDER_ITEMS_CONTINUATION_LABEL_ATTR = 'data-order-items-continuation-label'
export const ORDER_ITEMS_CONTINUATION_ATTR = 'data-order-items-continuation'
export const ORDER_ITEMS_CONTINUATION_TABLE_ATTR = 'data-order-items-continuation-table'
export const ORDER_ITEMS_TITLE_TEXT_ATTR = 'data-order-items-title-text'
export const ORDER_ITEMS_CONTINUATION_SUFFIX_ATTR = 'data-order-items-continuation-suffix'

const ORDER_ITEMS_PAGINATED_SELECTOR = `table[${ORDER_ITEMS_PAGINATED_ATTR}]`
const ORDER_ITEMS_CONTINUATION_SELECTOR = `[${ORDER_ITEMS_CONTINUATION_ATTR}]`
const ORDER_ITEMS_CONTINUATION_TABLE_SELECTOR = `table[${ORDER_ITEMS_CONTINUATION_TABLE_ATTR}]`
const ORDER_ITEMS_SECTION_SELECTOR = `[${ORDER_ITEMS_SECTION_ATTR}]`
const ORDER_ITEMS_TITLE_BAR_SELECTOR = `[${ORDER_ITEMS_TITLE_BAR_ATTR}]`

const SPLIT_EPSILON_MM = 0.05
const MAX_SPLIT_ITERATIONS = 500

export type OrderItemsRowSpan = {
    topMm: number
    bottomMm: number
}

export type OrderItemsSplitDecision = {
    rowIndex: number
    boundaryMm: number
}

/**
 * Finds where a statement table should be cut for the given page height.
 *
 * Rows are never split in half: the cut happens immediately above the first
 * row that would cross the boundary, so the previous page keeps every fully
 * visible row and the continuation starts with a whole row. When the table's
 * very first row already crosses the line there is nothing to cut above it —
 * the keep-together pagination moves the whole table to the next page instead.
 */
export function findOrderItemsSplitIndex(
    rows: readonly OrderItemsRowSpan[],
    pageHeightMm: number
): OrderItemsSplitDecision | null {
    if (rows.length === 0 || !Number.isFinite(pageHeightMm) || pageHeightMm <= 0) {
        return null
    }

    const firstTopMm = rows[0].topMm
    const lastBottomMm = rows[rows.length - 1].bottomMm
    const lastBoundaryIndex = Math.floor(lastBottomMm / pageHeightMm)

    for (let boundaryIndex = 1; boundaryIndex <= lastBoundaryIndex; boundaryIndex += 1) {
        const boundaryMm = boundaryIndex * pageHeightMm
        if (boundaryMm <= firstTopMm + SPLIT_EPSILON_MM) continue

        const crossingRowIndex = rows.findIndex((row) => row.bottomMm > boundaryMm + SPLIT_EPSILON_MM)
        if (crossingRowIndex > 0) {
            return { rowIndex: crossingRowIndex, boundaryMm }
        }
    }

    return null
}

/**
 * Undoes every previous split: moves the chunk rows back into their original
 * table (in reverse document order so each chunk is appended after the rows of
 * the chunk before it) and removes the continuation wrappers.
 */
export function restoreOrderItemsTableSplits(root: HTMLElement): void {
    const continuations = Array.from(root.querySelectorAll<HTMLElement>(ORDER_ITEMS_CONTINUATION_SELECTOR))

    for (let index = continuations.length - 1; index >= 0; index -= 1) {
        const continuation = continuations[index]
        const chunkTable = continuation.querySelector<HTMLTableElement>(ORDER_ITEMS_CONTINUATION_TABLE_SELECTOR)
        const movedRows = chunkTable
            ? Array.from(chunkTable.querySelectorAll('tbody > tr'))
            : []
        const targetTable = nearestPrecedingOrderItemsTable(continuation)

        if (targetTable && movedRows.length > 0) {
            const targetBody = targetTable.querySelector('tbody') || targetTable
            movedRows.forEach((row) => targetBody.appendChild(row))
        }

        continuation.remove()
    }
}

function nearestPrecedingOrderItemsTable(element: Element): HTMLTableElement | null {
    let previous = element.previousElementSibling

    while (previous) {
        if (previous.matches(`${ORDER_ITEMS_PAGINATED_SELECTOR}, ${ORDER_ITEMS_CONTINUATION_TABLE_SELECTOR}`)) {
            return previous as HTMLTableElement
        }
        previous = previous.previousElementSibling
    }

    return null
}

/**
 * Cuts every `[data-order-items-paginated]` table at each page boundary it
 * crosses. Idempotent: any previous split is restored first, then the tables
 * are re-split against their current (post-restore) flow positions.
 */
export function paginateOrderItemsTables(
    root: HTMLElement,
    options: { pageHeightMm: number; pageWidthMm: number }
): void {
    if (!root.querySelector(`${ORDER_ITEMS_PAGINATED_SELECTOR}, ${ORDER_ITEMS_CONTINUATION_TABLE_SELECTOR}`)) return

    restoreOrderItemsTableSplits(root)

    const rootRect = root.getBoundingClientRect()
    if (rootRect.width <= 0) return

    const pxToMm = options.pageWidthMm / rootRect.width

    for (let iteration = 0; iteration < MAX_SPLIT_ITERATIONS; iteration += 1) {
        const nextSplit = findNextOrderItemsTableSplit(root, options.pageHeightMm, pxToMm)
        if (!nextSplit) return
        applyOrderItemsTableSplit(nextSplit.table, nextSplit.rowIndex)
    }
}

function findNextOrderItemsTableSplit(
    root: HTMLElement,
    pageHeightMm: number,
    pxToMm: number
): { table: HTMLTableElement; rowIndex: number } | null {
    const rootRect = root.getBoundingClientRect()
    const tables = Array.from(root.querySelectorAll<HTMLTableElement>(
        `${ORDER_ITEMS_PAGINATED_SELECTOR}, ${ORDER_ITEMS_CONTINUATION_TABLE_SELECTOR}`
    ))

    for (const table of tables) {
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr'))
        if (rows.length === 0) continue

        const spans: OrderItemsRowSpan[] = rows.map((row) => {
            const rect = row.getBoundingClientRect()
            return {
                topMm: (rect.top - rootRect.top) * pxToMm,
                bottomMm: (rect.bottom - rootRect.top) * pxToMm
            }
        })

        const decision = findOrderItemsSplitIndex(spans, pageHeightMm)
        if (decision) {
            return { table, rowIndex: decision.rowIndex }
        }
    }

    return null
}

function getOrderItemsTitleParts(table: HTMLTableElement): { title: string; label: string | null } | null {
    const storedTitle = table.getAttribute(ORDER_ITEMS_TITLE_TEXT_ATTR)
    const storedLabel = table.getAttribute(ORDER_ITEMS_CONTINUATION_LABEL_ATTR)
    if (storedTitle != null && storedLabel != null) {
        return { title: storedTitle, label: storedLabel }
    }

    const section = table.closest<HTMLElement>(ORDER_ITEMS_SECTION_SELECTOR)
    const titleBar = section?.querySelector<HTMLElement>(ORDER_ITEMS_TITLE_BAR_SELECTOR)
    const title = titleBar?.querySelector('h2')?.textContent?.trim()
    const label = titleBar?.getAttribute(ORDER_ITEMS_CONTINUATION_LABEL_ATTR) || null

    return title ? { title, label } : null
}

/**
 * Moves `rowIndex` and every following row of the table into a new chunk table
 * that repeats the section title (with its "continued" label) and the column
 * header row, and inserts that chunk right after the source table.
 */
function applyOrderItemsTableSplit(table: HTMLTableElement, rowIndex: number): void {
    const sourceBody = table.querySelector('tbody')
    if (!sourceBody) return

    const rows = Array.from(sourceBody.querySelectorAll(':scope > tr'))
    const movedRows = rows.slice(rowIndex)
    if (movedRows.length === 0) return

    const continuation = document.createElement('div')
    continuation.setAttribute(ORDER_ITEMS_CONTINUATION_ATTR, '')

    const chunk = table.cloneNode(false) as HTMLTableElement
    chunk.removeAttribute(ORDER_ITEMS_PAGINATED_ATTR)
    chunk.setAttribute(ORDER_ITEMS_CONTINUATION_TABLE_ATTR, '')

    const titleParts = getOrderItemsTitleParts(table)
    if (titleParts) {
        chunk.setAttribute(ORDER_ITEMS_TITLE_TEXT_ATTR, titleParts.title)
        if (titleParts.label) {
            chunk.setAttribute(ORDER_ITEMS_CONTINUATION_LABEL_ATTR, titleParts.label)
        }
    }

    const head = table.querySelector('thead')
    const headerRow = Array.from(head?.querySelectorAll('tr') || [])
        .find((tr) => !tr.hasAttribute(ORDER_ITEMS_CONTINUATION_LABEL_ATTR))
    const columnCount = headerRow?.children.length || 1

    const chunkHead = head ? (head.cloneNode(true) as HTMLTableSectionElement) : document.createElement('thead')
    chunkHead.querySelector(`tr[${ORDER_ITEMS_CONTINUATION_LABEL_ATTR}]`)?.remove()
    chunkHead.insertBefore(buildContinuationTitleRow(titleParts, columnCount), chunkHead.firstChild)
    chunk.appendChild(chunkHead)

    const chunkBody = document.createElement('tbody')
    movedRows.forEach((row) => chunkBody.appendChild(row))
    chunk.appendChild(chunkBody)

    continuation.appendChild(chunk)
    table.insertAdjacentElement('afterend', continuation)
}

function buildContinuationTitleRow(
    titleParts: { title: string; label: string | null } | null,
    columnCount: number
): HTMLTableRowElement {
    const row = document.createElement('tr')
    row.setAttribute(ORDER_ITEMS_CONTINUATION_LABEL_ATTR, titleParts?.label || '')

    const cell = document.createElement('td')
    cell.colSpan = columnCount
    cell.className = 'border border-slate-300 p-1 text-start'

    const bar = document.createElement('div')
    bar.className = 'flex items-center justify-between'

    const heading = document.createElement('h2')
    heading.className = 'text-sm font-bold'
    heading.textContent = titleParts?.title || ''

    if (titleParts?.label) {
        const suffix = document.createElement('span')
        suffix.setAttribute(ORDER_ITEMS_CONTINUATION_SUFFIX_ATTR, '')
        suffix.className = 'ms-1 text-[9px] font-normal text-slate-500'
        suffix.textContent = titleParts.label
        heading.appendChild(suffix)
    }

    bar.appendChild(heading)
    cell.appendChild(bar)
    row.appendChild(cell)
    return row
}
