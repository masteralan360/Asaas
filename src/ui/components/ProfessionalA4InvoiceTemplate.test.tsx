import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
    PROFESSIONAL_A4_TABLE_ROW_COUNT,
    ProfessionalA4InvoiceTemplate
} from './ProfessionalA4InvoiceTemplate'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: {
            language: 'en',
            getFixedT: () => (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key
        }
    })
}))

vi.mock('@/services/platformService', () => ({
    platformService: {
        convertFileSrc: (path: string) => path
    }
}))

vi.mock('@/lib/utils', () => ({
    cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
    formatCurrency: (amount: number, currency: string) => `${currency.toUpperCase()} ${amount}`,
    formatDateTime: (value: string) => value
}))

describe('ProfessionalA4InvoiceTemplate', () => {
    it('renders exactly 20 item table rows', () => {
        const html = renderToStaticMarkup(
            <ProfessionalA4InvoiceTemplate
                data={{
                    id: 'invoice-1',
                    invoiceid: '#001',
                    created_at: new Date('2026-06-23T08:00:00Z').toISOString(),
                    cashier_name: 'Cashier',
                    items: [
                        {
                            product_id: 'product-1',
                            product_name: 'First Product',
                            product_sku: 'SKU-1',
                            quantity: 2,
                            unit_price: 25,
                            total_price: 50,
                            settlement_currency: 'usd'
                        },
                        {
                            product_id: 'product-2',
                            product_name: 'Second Product',
                            product_sku: 'SKU-2',
                            quantity: 1,
                            unit_price: 30,
                            total_price: 30,
                            settlement_currency: 'usd'
                        }
                    ],
                    total_amount: 80,
                    subtotal_amount: 80,
                    settlement_currency: 'usd',
                    payment_method: 'cash'
                }}
                features={{
                    print_lang: 'en',
                    print_qr: false,
                    iqd_display_preference: 'IQD'
                }}
                workspaceName="Atlas Test"
            />
        )

        expect(html.match(/data-professional-item-row=""/g)).toHaveLength(PROFESSIONAL_A4_TABLE_ROW_COUNT)
        expect(html).toContain('First Product')
        expect(html).toContain('Second Product')
    })

    it('omits hidden professional card values from static print output', () => {
        const html = renderToStaticMarkup(
            <ProfessionalA4InvoiceTemplate
                data={{
                    id: 'invoice-2',
                    invoiceid: '#002',
                    created_at: new Date('2026-06-23T08:00:00Z').toISOString(),
                    cashier_name: 'Hidden Cashier',
                    items: [],
                    total_amount: 120,
                    subtotal_amount: 120,
                    settlement_currency: 'usd',
                    payment_method: 'cash',
                    hiddenPrintFields: {
                        'professional.saleSummary.soldBy': true
                    }
                }}
                features={{
                    print_lang: 'en',
                    print_qr: false,
                    iqd_display_preference: 'IQD'
                }}
                workspaceName="Atlas Test"
            />
        )

        expect(html).toContain('Invoice #')
        expect(html).not.toContain('Sold By')
        expect(html).not.toContain('Hidden Cashier')
    })
})
