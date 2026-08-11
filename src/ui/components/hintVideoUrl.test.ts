import { describe, expect, it } from 'vitest'
import { resolveHintVideoUrl } from './hintVideoUrl'

describe('resolveHintVideoUrl', () => {
    it('loads video hints from the R2 hints prefix', () => {
        const url = resolveHintVideoUrl('print_order.mp4')

        expect(url).toBe(`${import.meta.env.VITE_R2_WORKER_URL?.replace(/\/+$/, '')}/hints/print_order.mp4`)
        expect(url).not.toContain('/tips/')
    })

    it('maps legacy tips paths to the R2 hints prefix', () => {
        expect(resolveHintVideoUrl('/tips/pos_checkout.mp4')).toContain('/hints/pos_checkout.mp4')
    })

    it('preserves external video URLs', () => {
        expect(resolveHintVideoUrl('https://example.com/help.mp4')).toBe('https://example.com/help.mp4')
    })
})
