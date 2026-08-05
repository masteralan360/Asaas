/**
 * Centers marked tables vertically on their A4 page.
 *
 * Templates that chunk overflowing order item rows into continuation tables
 * (for example the Atlas Standard order invoice) mark those tables with
 * `data-centered-table`. This routine inserts an invisible spacer before each
 * marked table so it lands vertically centered on its own page instead of
 * starting right after the previous page's content.
 *
 * The same DOM routine is used by the PDF preview (`PdfPreviewPage`) and by
 * the canvas→PDF generator (`pdfGenerator`), which keeps the on-screen preview
 * and the exported document in sync.
 */

export const CENTERED_TABLE_ATTR = 'data-centered-table'
export const CENTERED_TABLE_SPACER_ATTR = 'data-centered-table-spacer'

const FIT_EPSILON_MM = 0.05

export type CenteredTablePlacement = {
    tableIndex: number
    spacerMm: number
}

/**
 * Decides where invisible spacers must be inserted so every marked table is
 * vertically centered on its own A4 page. `topsMm` and `heightsMm` are the
 * tables' natural (spacer-free) flow positions; the returned placements
 * describe the spacer to insert before each moved table. Spacers shift later
 * tables, so the running shift is folded into each decision.
 */
export function planCenteredTableSpacers(
    topsMm: readonly number[],
    heightsMm: readonly number[],
    pageHeightMm: number
): CenteredTablePlacement[] {
    if (topsMm.length === 0 || topsMm.length !== heightsMm.length) return []
    if (!Number.isFinite(pageHeightMm) || pageHeightMm <= 0) return []

    const placements: CenteredTablePlacement[] = []
    let shiftMm = 0

    for (let index = 0; index < topsMm.length; index += 1) {
        const topMm = topsMm[index] + shiftMm
        const heightMm = heightsMm[index]
        if (!Number.isFinite(topMm) || !Number.isFinite(heightMm) || heightMm <= 0) continue

        const startPage = Math.floor(topMm / pageHeightMm)
        const fitsOnStartPage = topMm + heightMm
            <= ((startPage + 1) * pageHeightMm) + FIT_EPSILON_MM
        const pageIndex = fitsOnStartPage ? startPage : startPage + 1
        const targetTopMm = (pageIndex * pageHeightMm) + ((pageHeightMm - heightMm) / 2)
        const spacerMm = targetTopMm - topMm

        if (spacerMm > FIT_EPSILON_MM) {
            placements.push({ tableIndex: index, spacerMm })
            shiftMm += spacerMm
        }
    }

    return placements
}

/**
 * Centers every `[data-centered-table]` table vertically on its own A4 page.
 * Idempotent: previously inserted spacers are removed first, then the tables
 * are re-centered against their current (post-restore) flow positions.
 */
export function centerTablesOnPages(
    root: HTMLElement,
    options: { pageHeightMm: number; pageWidthMm: number }
): void {
    root.querySelectorAll<HTMLElement>(`[${CENTERED_TABLE_SPACER_ATTR}]`).forEach((spacer) => spacer.remove())

    const tables = Array.from(root.querySelectorAll<HTMLTableElement>(`table[${CENTERED_TABLE_ATTR}]`))
    if (tables.length === 0) return

    const rootRect = root.getBoundingClientRect()
    if (rootRect.width <= 0) return

    const pxToMm = options.pageWidthMm / rootRect.width
    const topsMm = tables.map((table) => (table.getBoundingClientRect().top - rootRect.top) * pxToMm)
    const heightsMm = tables.map((table) => table.getBoundingClientRect().height * pxToMm)
    const placements = planCenteredTableSpacers(topsMm, heightsMm, options.pageHeightMm)

    for (const placement of placements) {
        const spacer = document.createElement('div')
        spacer.setAttribute(CENTERED_TABLE_SPACER_ATTR, '')
        spacer.style.height = `${placement.spacerMm}mm`
        tables[placement.tableIndex].insertAdjacentElement('beforebegin', spacer)
    }
}
