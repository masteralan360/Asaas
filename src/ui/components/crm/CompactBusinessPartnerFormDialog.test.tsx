import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}))

vi.mock('@/ui/components', async () => {
    const React = await import('react')
    const Container = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
        React.createElement('div', props, children)

    return {
        AppDialog: Container,
        AppDialogBody: Container,
        AppDialogContent: Container,
        AppDialogFooter: Container,
        AppDialogHeader: Container,
        AppDialogTitle: Container,
        Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
            React.createElement('button', props, children),
        Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
            React.createElement('input', props),
        Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) =>
            React.createElement('label', props, children)
    }
})

import { CompactBusinessPartnerFormDialog } from './CompactBusinessPartnerFormDialog'

describe('CompactBusinessPartnerFormDialog', () => {
    it('renders only the required partner name, phone, and address fields', () => {
        const html = renderToStaticMarkup(
            <CompactBusinessPartnerFormDialog
                isOpen
                onOpenChange={() => undefined}
                role="customer"
                defaultCurrency="usd"
                onSubmit={() => undefined}
            />
        )

        expect(html).toContain('businessPartners.form.partnerName')
        expect(html).toContain('customers.form.phone')
        expect(html).toContain('customers.form.address')
        expect(html.match(/<input/g)).toHaveLength(3)
        expect(html).not.toContain('businessPartners.form.role')
        expect(html).not.toContain('customers.form.defaultCurrency')
    })
})
