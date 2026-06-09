import { describe, it, expect } from 'vitest'
import { convertArabicIndicToLatin, sanitizeNumericInput, parseFormattedNumber } from './utils'

describe('Arabic/Persian Numeral Conversion', () => {
    describe('convertArabicIndicToLatin', () => {
        it('should convert Arabic-Indic digits', () => {
            expect(convertArabicIndicToLatin('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
        })

        it('should convert Persian digits', () => {
            expect(convertArabicIndicToLatin('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
        })

        it('should handle mixed input', () => {
            expect(convertArabicIndicToLatin('١٢٣ Main St 456')).toBe('123 Main St 456')
        })

        it('should handle empty input', () => {
            expect(convertArabicIndicToLatin('')).toBe('')
        })

        it('should handle null/undefined', () => {
            expect(convertArabicIndicToLatin(null as any)).toBe(null)
        })
    })

    describe('sanitizeNumericInput with Arabic digits', () => {
        it('should convert and sanitize whole numbers', () => {
            expect(sanitizeNumericInput('١،٢٣٤')).toBe('1234')
        })

        it('should handle decimals with Arabic digits', () => {
            // Note: Arabic decimals sometimes use U+066B (decimal separator) or U+066C (thousands separator)
            // But usually in inputs they might use standard dot if the keyboard handles it, 
            // or we might need to handle those too. 
            // For now, testing basic digit conversion.
            expect(sanitizeNumericInput('١٢.٣٤')).toBe('12.34')
        })
    })

    describe('parseFormattedNumber with Arabic digits', () => {
        it('should parse Arabic numbers with commas', () => {
            expect(parseFormattedNumber('١،٢٣٤.٥٦')).toBe(1234.56)
        })
    })
})
