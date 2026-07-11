import { describe, expect, it } from 'vitest'
import {
    actualTransferToChargedUsage,
    chargedUsageToApproximateActualTransfer,
    WORKSPACE_USAGE_CHARGE_MULTIPLIER
} from './workspaceUsageCharging'

describe('workspace usage charging', () => {
    it('keeps the commercial multiplier explicit', () => {
        expect(WORKSPACE_USAGE_CHARGE_MULTIPLIER).toBe(10)
        expect(actualTransferToChargedUsage(100_000_000)).toBe(1_000_000_000)
        expect(actualTransferToChargedUsage(100 * 1024 * 1024)).toBe(1000 * 1024 * 1024)
    })

    it('converts charged usage back to approximate actual transfer for compatibility', () => {
        expect(chargedUsageToApproximateActualTransfer(1000)).toBe(100)
        expect(chargedUsageToApproximateActualTransfer(-1)).toBe(0)
    })
})
