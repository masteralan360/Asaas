import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key
    })
}))

vi.mock('@/workspace', () => ({
    useWorkspace: () => ({
        hasCapability: () => true
    })
}))

vi.mock('@/ui/components/button', async () => {
    const React = await import('react')
    return {
        Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
            React.createElement('button', props, children)
    }
})

vi.mock('@/ui/components/small-dialog', async () => {
    const React = await import('react')
    const Container = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
    return {
        SmallDialog: Container,
        SmallDialogContent: Container,
        SmallDialogHeader: Container,
        SmallDialogTitle: Container
    }
})

let PrintSelectionModal: typeof import('./PrintSelectionModal')['PrintSelectionModal']

beforeAll(async () => {
    ;({ PrintSelectionModal } = await import('./PrintSelectionModal'))
})

describe('PrintSelectionModal', () => {
    it('renders native formats and saved custom templates in one selection surface', () => {
        const customTemplate = {
            id: 'partner-template',
            module_type_key: 'businessPartners.Details',
            label: 'Executive Partner Layout',
            layout_json: {},
            active: true,
            primary: true
        }

        const html = renderToStaticMarkup(
            <PrintSelectionModal
                isOpen
                onClose={() => undefined}
                onSelect={() => undefined}
                nativeOptions={[
                    {
                        format: 'receipt',
                        label: 'Thermal Receipt',
                        description: 'Compact receipt'
                    },
                    {
                        format: 'a4',
                        label: 'Partner Details A4',
                        description: 'Full-page partner details'
                    }
                ]}
                templateOptions={[
                    {
                        format: 'a4',
                        template: customTemplate,
                        label: 'Executive Partner Layout',
                        description: 'Custom A4 Print',
                        primary: true
                    }
                ]}
            />
        )

        expect(html).toContain('Thermal Receipt')
        expect(html).toContain('Partner Details A4')
        expect(html).toContain('Executive Partner Layout')
        expect(html).toContain('Custom A4 Print')
        expect(html).toContain('Primary')
    })

    it('expands a single option and allows its description to wrap', () => {
        const html = renderToStaticMarkup(
            <PrintSelectionModal
                isOpen
                onClose={() => undefined}
                onSelect={() => undefined}
                nativeOptions={[
                    {
                        format: 'a4',
                        label: 'Partner Details A4',
                        description: 'Use the built-in Partner Details A4 layout.'
                    }
                ]}
            />
        )

        expect(html).toContain('sm:col-span-2')
        expect(html).toContain('whitespace-normal')
        expect(html).toContain('line-clamp-2')
    })

    it('keeps an incompatible template visible but disabled with a warning', () => {
        const html = renderToStaticMarkup(
            <PrintSelectionModal
                isOpen
                onClose={() => undefined}
                onSelect={() => undefined}
                nativeOptions={[]}
                templateOptions={[{
                    format: 'receipt',
                    template: {
                        id: 'arabic-template',
                        module_type_key: 'salesHistory.Receipt',
                        label: 'Arabic Receipt',
                        layout_json: { printLanguage: 'ar' }
                    },
                    label: 'Arabic Receipt',
                    disabled: true,
                    warning: 'Saved for AR, but workspace printing is EN.'
                }]}
            />
        )

        expect(html).toContain('Arabic Receipt')
        expect(html).toContain('Saved for AR, but workspace printing is EN.')
        expect(html).toContain('disabled=""')
    })
})
