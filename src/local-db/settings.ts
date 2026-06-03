import { db } from './database'
import { encryptSensitiveValue, decryptSensitiveValue } from '@/lib/encryption'

const SENSITIVE_KEYS = ['supabase_url', 'supabase_anon_key']

export async function getAppSetting(key: string): Promise<string | undefined> {
    const setting = await db.app_settings.get(key)
    if (!setting) return undefined

    if (!SENSITIVE_KEYS.includes(key)) {
        return setting.value
    }

    return decryptSensitiveValue(setting.value)
}

export async function setAppSetting(key: string, value: string): Promise<void> {
    const valueToStore = SENSITIVE_KEYS.includes(key) ? encryptSensitiveValue(value) : value
    await db.app_settings.put({ key, value: valueToStore })
    // Mirror to localStorage for synchronous access on startup
    localStorage.setItem(`app_setting_${key}`, valueToStore)
}

export async function clearAppSetting(key: string): Promise<void> {
    await db.app_settings.delete(key)
    localStorage.removeItem(`app_setting_${key}`)
}

export function getAppSettingSync(key: string): string | null {
    const value = localStorage.getItem(`app_setting_${key}`)
    if (!value) return null

    if (!SENSITIVE_KEYS.includes(key)) {
        return value
    }

    return decryptSensitiveValue(value) ?? null
}
