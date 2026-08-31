import { describe, expect, it } from 'vitest'
import { calculateUsageAfterFreeGrant, formatFreeUsageGigabytes } from './freeUsageGrants'

describe('free usage grants', () => {
    it('subtracts a grant and preserves the remaining charged usage', () => {
        expect(calculateUsageAfterFreeGrant(5_000_000_000n, 1_250_000_000n)).toBe(3_750_000_000n)
    })

    it('clamps a grant that exceeds the charged usage at zero without creating credit', () => {
        expect(calculateUsageAfterFreeGrant(900_000_000n, 1_000_000_000n)).toBe(0n)
    })

    it('rejects a zero grant and formats exact decimal-gigabyte amounts', () => {
        expect(() => calculateUsageAfterFreeGrant(1n, 0n)).toThrow('greater than zero')
        expect(formatFreeUsageGigabytes(1_234_567_000n, 'en-US')).toBe('1.234567')
    })
})

