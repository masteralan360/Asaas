import { db } from './database'
import { encrypt, decrypt } from '@/lib/encryption'

const SENSITIVE_KEYS = ['supabase_url', 'supabase_anon_key']

export async function getAppSetting(key: string): Promise<string | undefined> {
    const setting = await db.app_settings.get(key)
    if (!setting) return undefined

    return SENSITIVE_KEYS.includes(key) ? decrypt(setting.value) : setting.value
}

export async function setAppSetting(key: string, value: string): Promise<void> {
    const valueToStore = SENSITIVE_KEYS.includes(key) ? encrypt(value) : value
    await db.app_settings.put({ key, value: valueToStore })
    // Mirror to localStorage for synchronous access on startup
    localStorage.setItem(`app_setting_${key}`, valueToStore)
}

export function getAppSettingSync(key: string): string | null {
    const value = localStorage.getItem(`app_setting_${key}`)
    if (!value) return null

    return SENSITIVE_KEYS.includes(key) ? decrypt(value) : value
}
