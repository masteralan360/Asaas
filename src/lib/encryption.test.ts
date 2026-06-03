import CryptoJS from 'crypto-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    decrypt,
    decryptSensitiveValue,
    encrypt,
    encryptSensitiveValue,
    isEncryptedValue,
} from './encryption'

const LEGACY_ENCRYPTION_KEY = 'iraqcore-supabase-key'
const decryptForTest = (ciphertext: string, key: string): string | null => {
    try {
        return CryptoJS.AES.decrypt(ciphertext, key).toString(CryptoJS.enc.Utf8) || null
    } catch {
        return null
    }
}

describe('encryption helpers', () => {
    beforeEach(() => {
        vi.unstubAllEnvs()
    })

    it('encrypts new values with the configured key instead of the legacy fallback', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', 'configured-local-key')

        const encrypted = encrypt('plain secret')

        expect(isEncryptedValue(encrypted)).toBe(true)
        expect(decryptForTest(encrypted, 'configured-local-key')).toBe('plain secret')
        expect(decryptForTest(encrypted, LEGACY_ENCRYPTION_KEY)).not.toBe('plain secret')
    })

    it('throws instead of encrypting new values with the legacy fallback when no key is configured', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', '')

        expect(() => encrypt('plain secret')).toThrow(/VITE_ENCRYPTION_KEY/)
        expect(() => encryptSensitiveValue('plain secret')).toThrow(/VITE_ENCRYPTION_KEY/)
    })

    it('can still decrypt legacy ciphertext when no current key is configured', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', '')

        const legacyEncrypted = CryptoJS.AES.encrypt('legacy secret', LEGACY_ENCRYPTION_KEY).toString()

        expect(decrypt(legacyEncrypted)).toBe('legacy secret')
        expect(decryptSensitiveValue(legacyEncrypted)).toBe('legacy secret')
    })

    it('fails closed for sensitive values that are plaintext or undecryptable', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', 'configured-local-key')

        expect(decryptSensitiveValue('https://example.supabase.co')).toBeUndefined()
        expect(decryptSensitiveValue('U2FsdGVkX1invalid')).toBeUndefined()
    })

    it('migrates legacy encrypted sensitive values to the configured key on write', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', 'configured-local-key')

        const legacyEncrypted = CryptoJS.AES.encrypt('legacy secret', LEGACY_ENCRYPTION_KEY).toString()
        const migrated = encryptSensitiveValue(legacyEncrypted)

        expect(migrated).not.toBe(legacyEncrypted)
        expect(decryptForTest(migrated, 'configured-local-key')).toBe('legacy secret')
    })
})
