import { describe, expect, it } from 'vitest'

import { generateBarcodeLabelsPdf } from './barcodeLabelPdf'

const labels = [
    { id: 'first', barcode: 'WE54070882', displayValue: 'WE54070882', price: 1234, currency: 'iqd', unit: 'pcs', iqdDisplayPreference: 'IQD' as const },
    { id: 'second', barcode: 'WE54070883', displayValue: 'WE54070883', price: 99, currency: 'usd', unit: 'pcs', iqdDisplayPreference: 'IQD' as const }
]

describe('barcode label PDF', () => {
    it('creates one 35 × 15 mm PDF page for each label in its input order', async () => {
        const pdf = await generateBarcodeLabelsPdf({ labels })
        const pdfText = await pdf.text()

        expect(pdf.type).toBe('application/pdf')
        expect(pdfText).toContain('WE54070882')
        expect(pdfText).toContain('WE54070883')
        expect(pdfText.indexOf('WE54070882')).toBeLessThan(pdfText.indexOf('WE54070883'))
        expect((pdfText.match(/\/Type \/Page\b/g) || []).length).toBe(2)
    })

    it('omits both price strings when the price control is disabled', async () => {
        const pdf = await generateBarcodeLabelsPdf({ labels, showPrice: false })
        const pdfText = await pdf.text()

        expect(pdfText).not.toContain('Price')
        expect(pdfText).not.toContain('1,234 IQD')
        expect(pdfText).toContain('WE54070882')
    })
})
