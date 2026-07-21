export const A4_PAGE_HEIGHT_MM = 297

export type A4KeepTogetherBlock = {
    topMm: number
    bottomMm: number
}

const PAGE_BREAK_EPSILON_MM = 0.01

/**
 * Returns the source offsets for each A4 page. When a marked block would
 * cross a page boundary, its whole block starts on the following page.
 */
export function getA4PageStarts(
    contentHeightMm: number,
    blocks: readonly A4KeepTogetherBlock[] = [],
    pageHeightMm = A4_PAGE_HEIGHT_MM
) {
    if (!Number.isFinite(contentHeightMm) || contentHeightMm <= 0) {
        return [0]
    }

    const usablePageHeight = Math.max(1, pageHeightMm)
    const keepTogetherBlocks = blocks.filter((block) => {
        const height = block.bottomMm - block.topMm
        return Number.isFinite(block.topMm)
            && Number.isFinite(block.bottomMm)
            && height > PAGE_BREAK_EPSILON_MM
            && height <= usablePageHeight + PAGE_BREAK_EPSILON_MM
    })
    const pageStarts = [0]
    let pageStartMm = 0

    while (pageStartMm + usablePageHeight < contentHeightMm - PAGE_BREAK_EPSILON_MM) {
        const naturalPageEndMm = pageStartMm + usablePageHeight
        const crossingBlocks = keepTogetherBlocks.filter((block) => (
            block.topMm > pageStartMm + PAGE_BREAK_EPSILON_MM
            && block.topMm < naturalPageEndMm - PAGE_BREAK_EPSILON_MM
            && block.bottomMm > naturalPageEndMm + PAGE_BREAK_EPSILON_MM
        ))
        const nextPageStartMm = crossingBlocks.length > 0
            ? Math.min(...crossingBlocks.map((block) => block.topMm))
            : naturalPageEndMm

        // A block that begins at the current page start cannot be moved any
        // further. Advance by a full page so pagination always makes progress.
        pageStartMm = nextPageStartMm > pageStartMm + PAGE_BREAK_EPSILON_MM
            ? nextPageStartMm
            : naturalPageEndMm
        pageStarts.push(pageStartMm)
    }

    return pageStarts
}
