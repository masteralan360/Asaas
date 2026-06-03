import CryptoJS from 'crypto-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appSettingsMock = vi.hoisted(() => {
    const rows = new Map<string, string>()

    const table = {
        get: vi.fn(async (key: string) => {
            const value = rows.get(key)
            return value === undefined ? undefined : { key, value }
        }),
        put: vi.fn(async (row: { key: string; value: string }) => {
            rows.set(row.key, row.value)
        }),
        delete: vi.fn(async (key: string) => {
            rows.delete(key)
        }),
    }

    return {
        rows,
        table,
        reset() {
            rows.clear()
            table.get.mockClear()
            table.put.mockClear()
            table.delete.mockClear()
        },
    }
})

vi.mock('./database', () => ({
    db: {
        app_settings: appSettingsMock.table,
    },
}))

import { getAppSettingSync, setAppSetting } from './settings'

const LEGACY_ENCRYPTION_KEY = 'iraqcore-supabase-key'

const installLocalStorageMock = () => {
    const rows = new Map<string, string>()

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: vi.fn((key: string) => rows.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => {
                rows.set(key, value)
            }),
            removeItem: vi.fn((key: string) => {
                rows.delete(key)
            }),
            clear: vi.fn(() => {
                rows.clear()
            }),
        },
    })
}

describe('app settings encryption', () => {
    beforeEach(() => {
        vi.unstubAllEnvs()
        appSettingsMock.reset()
        installLocalStorageMock()
    })

    it('does not persist sensitive settings when encryption cannot be performed', async () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', '')

        await expect(setAppSetting('supabase_anon_key', 'plain secret')).rejects.toThrow(/VITE_ENCRYPTION_KEY/)

        expect(appSettingsMock.table.put).not.toHaveBeenCalled()
        expect(localStorage.setItem).not.toHaveBeenCalled()
    })

    it('keeps non-sensitive settings writable without encryption', async () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', '')

        await setAppSetting('hour_display_preference', '12-hour')

        expect(appSettingsMock.rows.get('hour_display_preference')).toBe('12-hour')
        expect(localStorage.setItem).toHaveBeenCalledWith('app_setting_hour_display_preference', '12-hour')
    })

    it('reads legacy encrypted sensitive settings from synchronous storage', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', '')

        const legacyEncrypted = CryptoJS.AES.encrypt('legacy secret', LEGACY_ENCRYPTION_KEY).toString()
        localStorage.setItem('app_setting_supabase_anon_key', legacyEncrypted)

        expect(getAppSettingSync('supabase_anon_key')).toBe('legacy secret')
    })

    it('does not return plaintext sensitive settings from synchronous storage', () => {
        vi.stubEnv('VITE_ENCRYPTION_KEY', 'configured-local-key')

        localStorage.setItem('app_setting_supabase_anon_key', 'plain secret')

        expect(getAppSettingSync('supabase_anon_key')).toBeNull()
    })
})
