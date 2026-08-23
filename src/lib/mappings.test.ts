import { describe, expect, it } from 'vitest'
import { mapSaleToUniversal } from './mappings'

describe('mapSaleToUniversal', () => {
    it('preserves the source origin used by source-specific receipt templates', () => {
        const invoice = mapSaleToUniversal({
            id: 'instant-sale-1',
            created_at: '2026-08-23T20:46:00.000Z',
            workspace_id: 'workspace-1',
            cashier_name: 'Cashier',
            total_amount: 20,
            settlement_currency: 'usd',
            origin: 'instant_pos',
            payment_method: 'cash',
            notes: 'No onions, please.',
            items: []
        } as any)

        expect(invoice.origin).toBe('instant_pos')
        expect(invoice.notes).toBe('No onions, please.')
    })
})
