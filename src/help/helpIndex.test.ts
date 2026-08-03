import { describe, expect, it } from 'vitest'
import { searchHelp } from './helpIndex'

describe('searchHelp', () => {
    it('matches the stock video for common phrasings', () => {
        for (const query of ['how to adjust stock', 'add stock', 'adjust stock', 'How to add product stock', 'stock quantity', 'إضافة مخزون', 'كيف أضيف مخزون', 'گۆڕینی کۆگا']) {
            const results = searchHelp(query, 'en')
            expect(results.length, `query: ${query}`).toBeGreaterThan(0)
            expect(results[0].topic.id).toBe('adjust-stock')
        }
    })

    it('matches the exchange rate video for common phrasings', () => {
        for (const query of ['how to edit exchange rate', 'edit exchange rate', 'change exchange rate', 'set manual rate', 'manual rate', 'exchange rate', 'سعر الصرف', 'تعديل سعر الصرف يدويا', 'نرخی ئاڵوگۆڕ', 'گۆڕینی نرخی ئاڵوگۆڕ']) {
            const results = searchHelp(query, 'en')
            expect(results.length, `query: ${query}`).toBeGreaterThan(0)
            expect(results[0].topic.id, `query: ${query}`).toBe('edit-exchange-rate')
        }
    })

    it('ranks each topic first for its own query', () => {
        const stock = searchHelp('how to adjust stock quantity', 'en')
        const rate = searchHelp('how to change exchange rate', 'en')
        expect(stock[0].topic.id).toBe('adjust-stock')
        expect(rate[0].topic.id).toBe('edit-exchange-rate')
    })

    it('matches Arabic keywords even when the UI language is English', () => {
        const results = searchHelp('تعديل الكمية', 'en')
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].topic.id).toBe('adjust-stock')
    })

    it('returns nothing for an empty query', () => {
        expect(searchHelp('', 'en')).toEqual([])
        expect(searchHelp('   ', 'en')).toEqual([])
    })
})
