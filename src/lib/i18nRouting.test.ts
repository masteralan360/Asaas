import { describe, expect, it } from 'vitest'
import { getLanguageDirection } from '@/lib/i18nRouting'

describe('getLanguageDirection', () => {
    it('treats Kurdish and Arabic as RTL languages', () => {
        expect(getLanguageDirection('ar')).toBe('rtl')
        expect(getLanguageDirection('ku')).toBe('rtl')
        expect(getLanguageDirection('ckb')).toBe('rtl')
    })

    it('normalizes regional language codes', () => {
        expect(getLanguageDirection('ku-IQ')).toBe('rtl')
        expect(getLanguageDirection('ar_IQ')).toBe('rtl')
        expect(getLanguageDirection('en-US')).toBe('ltr')
    })

    it('defaults missing and unsupported languages to LTR', () => {
        expect(getLanguageDirection(null)).toBe('ltr')
        expect(getLanguageDirection(undefined)).toBe('ltr')
        expect(getLanguageDirection('en')).toBe('ltr')
    })
})
