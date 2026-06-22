import { describe, expect, it } from 'vitest'

import { resolveIsolatedTextDirection } from '@/lib/textDirection'

describe('resolveIsolatedTextDirection', () => {
    it('keeps grouped phone numbers left-to-right', () => {
        expect(resolveIsolatedTextDirection('0770 199 0012')).toBe('ltr')
        expect(resolveIsolatedTextDirection('+964 (770) 199-0012')).toBe('ltr')
        expect(resolveIsolatedTextDirection('٠٧٧٠ ١٩٩ ٠٠١٢')).toBe('ltr')
    })

    it('uses the first strong letter for natural language text', () => {
        expect(resolveIsolatedTextDirection('ژمارەی مۆبایل')).toBe('rtl')
        expect(resolveIsolatedTextDirection('ەو ژمارەیە')).toBe('rtl')
        expect(resolveIsolatedTextDirection('رقم الهاتف')).toBe('rtl')
        expect(resolveIsolatedTextDirection('Phone 0770 199 0012')).toBe('ltr')
    })
})
