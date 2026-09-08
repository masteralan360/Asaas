// Touch users often rest a finger on a quantity control while scrolling the
// POS product lists, so require a noticeably deliberate hold before repeating.
export const MOBILE_CATALOG_QUANTITY_HOLD_DELAY_MS = 1_000
export const MOBILE_CATALOG_QUANTITY_CANCEL_DISTANCE_PX = 12

/**
 * Returns the pause before the next one-unit adjustment during a long press.
 * The amount remains predictable (+/- one); only the repetition rate ramps up.
 */
export function getMobileCatalogQuantityRepeatDelay(elapsedMs: number): number {
    const elapsed = Math.max(0, elapsedMs)

    if (elapsed < 2_000) return 280
    if (elapsed < 4_000) return 210
    if (elapsed < 6_000) return 150
    return 100
}
