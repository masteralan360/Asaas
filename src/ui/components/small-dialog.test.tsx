import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/utils', () => ({
    cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('./dialog', async () => {
    const React = await import('react')
    const Container = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
        React.createElement('div', props, children)
    const Content = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...props }, ref) => React.createElement('div', { ref, ...props }, children)
    )

    return {
        Dialog: Container,
        DialogBody: Container,
        DialogClose: Container,
        DialogContent: Content,
        DialogDescription: Container,
        DialogFooter: Container,
        DialogHeader: Container,
        DialogOverlay: Container,
        DialogPortal: Container,
        DialogTitle: Container,
        DialogTrigger: Container
    }
})

import { SmallDialogContent } from './small-dialog'

describe('SmallDialogContent', () => {
    it('uses the compact dialog width by default', () => {
        const html = renderToStaticMarkup(
            <SmallDialogContent>Compact content</SmallDialogContent>
        )

        expect(html).toContain('sm:max-w-md')
        expect(html).toContain('Compact content')
    })
})
