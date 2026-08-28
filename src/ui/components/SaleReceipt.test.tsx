import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UniversalInvoice } from '@/types'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: {
            language: 'en',
            getFixedT: () => (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key
        }
    })
}))
vi.mock('@/lib/utils', () => ({
    cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
    formatCurrency: (amount: number, currency: string) => `${amount} ${currency.toUpperCase()}`,
    formatDateTime: (value: string) => value,
    formatSnapshotTime: (value: string) => value
}))
vi.mock('@/services/platformService', () => ({
    platformService: {
        convertFileSrc: (path: string) => path
    }
}))
vi.mock('@/workspace', () => ({
    useWorkspace: () => ({ workspaceName: 'Atlas' })
}))
vi.mock('@/auth', () => ({
    useAuth: () => ({ user: null })
}))

import { SaleReceiptBase, SALE_RECEIPT_TEMPLATE_FIELD_KEYS } from './SaleReceipt'

const receiptData: UniversalInvoice = {
    id: 'sale-receipt-test',
    invoiceid: 'INV-001',
    created_at: '2026-08-28T12:00:00.000Z',
    cashier_name: 'Test Cashier',
    items: [{
        product_id: 'product-1',
        product_name: 'Test product',
        quantity: 1,
        unit_price: 10,
        total_price: 10
    }],
    total_amount: 10,
    settlement_currency: 'usd',
    notes: 'Visible receipt note'
}

function renderSalesReceipt(templateFields: Record<string, string> = {}) {
    return renderToStaticMarkup(
        <SaleReceiptBase
            data={receiptData}
            features={{}}
            workspaceName="Atlas"
            templateFields={templateFields}
            defaultShowNotes={false}
        />
    )
}

describe('SaleReceiptBase notes', () => {
    it('keeps Sales History notes hidden until the template setting is enabled', () => {
        const html = renderSalesReceipt()

        expect(html).not.toContain('data-order-print-component="receiptNotes"')
        expect(html).not.toContain('Visible receipt note')
    })

    it('renders Sales History notes using the configured font size', () => {
        const html = renderSalesReceipt({
            [SALE_RECEIPT_TEMPLATE_FIELD_KEYS.showNotes]: 'true',
            [SALE_RECEIPT_TEMPLATE_FIELD_KEYS.notesFontSize]: '18'
        })

        expect(html).toContain('data-order-print-component="receiptNotes"')
        expect(html).toContain('Visible receipt note')
        expect(html).toContain('font-size:18px')
    })
})
