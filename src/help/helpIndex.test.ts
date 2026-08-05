import { describe, expect, it } from 'vitest'
import { getTopicVideoSrc, searchHelp } from './helpIndex'

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

    it('matches the print order video for common phrasings', () => {
        for (const query of ['how to print an order', 'print order', 'print orders', 'print sales order', 'print receipt', 'print invoice', 'طباعة طلب', 'كيف أطبع فاتورة', 'چاپکردنی فرمان', 'چاپی داوکاری', 'چاپی فاتورە', 'فاتورة', 'وەسڵ چاپ بکە']) {
            const results = searchHelp(query, 'en')
            expect(results.length, `query: ${query}`).toBeGreaterThan(0)
            expect(results[0].topic.id, `query: ${query}`).toBe('print-order')
        }
    })

    it('matches the POS checkout video for common phrasings', () => {
        for (const query of ['how to checkout on POS', 'checkout on pos', 'how to checkout', 'checkout', 'make a sale', 'how to sell', 'sell a product', 'finalize sale', 'pos sale', 'كيفية البيع في نقطة البيع', 'كيفية بيع موفرەد', 'إتمام عملية البيع', 'نقطة البيع', 'چۆنێتی فڕۆشتن لە خاڵی فڕۆشتن', 'چۆنێتی فڕۆشتنی موفرەد', 'فڕۆشتن لە خاڵی فڕۆشتن', 'خاڵی فڕۆشتن']) {
            const results = searchHelp(query, 'en')
            expect(results.length, `query: ${query}`).toBeGreaterThan(0)
            expect(results[0].topic.id, `query: ${query}`).toBe('pos-checkout')
        }
    })

    it('matches the create loan video for loan-related phrasings', () => {
        for (const query of ['how to create loan', 'how to create a loan', 'create loan', 'create installment loan', 'create simple loan', 'register sale loan', 'installment schedule', 'loan number', 'borrower', 'كيفية انشاء قرض', 'إنشاء قرض تقسيط', 'تسجيل قرض للبيع', 'رقم القرض', 'جدول الأقساط', 'المقترض', 'چۆنێتی دروستکردنی قەرز', 'دروستکردنی قەرزی فرۆشتن', 'تۆمارکردنی قەرزی قیستی', 'ژمارەی قەرز', 'قەرزدار']) {
            const results = searchHelp(query, 'en')
            expect(results.length, `query: ${query}`).toBeGreaterThan(0)
            expect(results[0].topic.id, `query: ${query}`).toBe('create-loan')
        }
    })

    it('picks the language-specific video for create loan', () => {
        const createLoan = searchHelp('create loan', 'en')[0].topic
        expect(getTopicVideoSrc(createLoan, 'en')).toBe('/tips/create_loan_ku.mp4')
        expect(getTopicVideoSrc(createLoan, 'ar')).toBe('/tips/create_loan_ar.mp4')
        expect(getTopicVideoSrc(createLoan, 'ku')).toBe('/tips/create_loan_ku.mp4')
    })

    it('falls back to the default video for other topics', () => {
        const checkout = searchHelp('checkout', 'en')[0].topic
        expect(getTopicVideoSrc(checkout, 'ar')).toBe('/tips/pos_checkout.mp4')
        expect(getTopicVideoSrc(checkout, 'fr')).toBe('/tips/pos_checkout.mp4')
    })

    it('ranks each topic first for its own query', () => {
        const stock = searchHelp('how to adjust stock quantity', 'en')
        const rate = searchHelp('how to change exchange rate', 'en')
        const print = searchHelp('how do I print a sales order', 'en')
        const checkout = searchHelp('how do I checkout in point of sale', 'en')
        const loan = searchHelp('how do I create an installment loan', 'en')
        expect(stock[0].topic.id).toBe('adjust-stock')
        expect(rate[0].topic.id).toBe('edit-exchange-rate')
        expect(print[0].topic.id).toBe('print-order')
        expect(checkout[0].topic.id).toBe('pos-checkout')
        expect(loan[0].topic.id).toBe('create-loan')
    })

    it('matches Arabic keywords even when the UI language is English', () => {
        const results = searchHelp('تعديل الكمية', 'en')
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].topic.id).toBe('adjust-stock')
    })

    it('matches Kurdish typed with an Arabic keyboard layout', () => {
        const cases: Array<[string, string]> = [
            ['جونيتي دروستكردني قرز', 'create-loan'],
            ['جونيتي فروشتن ل خالي فروشتن', 'pos-checkout'],
            ['جون كوگا زياد بكم', 'adjust-stock'],
            ['جون نرخي ئالوكور دستكاري بكم', 'edit-exchange-rate'],
            ['جابكردني فرمان', 'print-order'],
            ['كيفية بيع موفرد', 'pos-checkout'],
        ]
        for (const [query, expectedId] of cases) {
            const results = searchHelp(query, 'ku')
            expect(results[0]?.topic.id, `query: ${query}`).toBe(expectedId)
        }
    })

    it('returns nothing for an empty query', () => {
        expect(searchHelp('', 'en')).toEqual([])
        expect(searchHelp('   ', 'en')).toEqual([])
    })
})
