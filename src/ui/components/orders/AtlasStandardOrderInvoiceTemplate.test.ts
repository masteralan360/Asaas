import { describe, expect, it } from 'vitest'

import { formatAtlasStandardPartnerCurrentBalance } from '@/lib/atlasStandardPartnerBalance'

describe('formatAtlasStandardPartnerCurrentBalance', () => {
    it('keeps each account-statement currency separate with circle separators and preserves signed balances', () => {
        expect(formatAtlasStandardPartnerCurrentBalance([
            { currency: 'iqd', closingBalance: -50_000 },
            { currency: 'usd', closingBalance: 12.34567 }
        ], 'IQD')).toBe('-50,000 IQD • $12.3457')
    })

    it('uses a placeholder when the statement has no currency ledger to show', () => {
        expect(formatAtlasStandardPartnerCurrentBalance([], 'IQD')).toBe('-')
    })
})
