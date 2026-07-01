import { describe, expect, it } from 'vitest'

import {
    createBarcodeScannerCodeIndex,
    getBarcodeScannerEventKey,
    normalizeBarcodeScannerText,
    shouldCommitBarcodeScannerValue
} from './barcodeScanner'

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
        key: '',
        code: '',
        shiftKey: false,
        getModifierState: () => false,
        ...overrides
    } as KeyboardEvent
}

describe('barcode scanner utilities', () => {
    it('normalizes Arabic and Persian digits plus bidi marks', () => {
        expect(normalizeBarcodeScannerText('\u200f١٢٣۴۵۶\u200e')).toBe('123456')
    })

    it('decodes scanner keys from physical keyboard codes', () => {
        expect(getBarcodeScannerEventKey(keyboardEvent({ key: 'ش', code: 'KeyA' }))).toBe('a')
        expect(getBarcodeScannerEventKey(keyboardEvent({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('!')
        expect(getBarcodeScannerEventKey(keyboardEvent({ key: '١', code: 'Digit1' }))).toBe('1')
    })

    it('waits on known prefixes instead of committing idle partial scans', () => {
        const index = createBarcodeScannerCodeIndex(['1234567890123', 'ABC-42'])

        expect(shouldCommitBarcodeScannerValue('12345', index)).toBe(false)
        expect(shouldCommitBarcodeScannerValue('1234567890123', index)).toBe(true)
        expect(shouldCommitBarcodeScannerValue('ABC', index)).toBe(false)
        expect(shouldCommitBarcodeScannerValue('ABC-42', index)).toBe(true)
    })

    it('allows explicit terminators to submit unknown complete scans', () => {
        const index = createBarcodeScannerCodeIndex(['1234567890123'])

        expect(shouldCommitBarcodeScannerValue('99887766', index)).toBe(false)
        expect(shouldCommitBarcodeScannerValue('99887766', index, { hasTerminator: true, allowUnknown: true })).toBe(true)
    })
})
