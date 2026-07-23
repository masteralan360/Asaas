import { describe, expect, it } from 'vitest'

import { getSyncIntegrityError, isSyncIntegrityError } from './syncErrors'

describe('sync integrity errors', () => {
    it.each([
        ['schema mismatch', Object.assign(new Error("Could not find the 'future_flag' column in the schema cache"), { code: 'PGRST204' })],
        ['permission rejection', Object.assign(new Error('permission denied for table products'), { code: '42501' })],
        ['validation rejection', Object.assign(new Error('violates check constraint "inventory_quantity_check"'), { code: '23514' })]
    ])('classifies a deterministic %s as an integrity issue', (_label, error) => {
        const storedError = getSyncIntegrityError('products', error)

        expect(storedError).toMatch(/^Sync integrity issue:/)
        expect(isSyncIntegrityError(storedError ?? undefined)).toBe(true)
    })

    it('does not block the app for ordinary connectivity failures', () => {
        expect(getSyncIntegrityError('products', new Error('network timeout'))).toBeNull()
        expect(isSyncIntegrityError('network timeout')).toBe(false)
    })
})
