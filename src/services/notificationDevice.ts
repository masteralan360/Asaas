import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { isMobile, isTauri } from '@/lib/platform'

const TOKEN_STORAGE_KEY_PREFIX = 'asaas_fcm_device_token'

async function readAndroidFcmToken(): Promise<string | null> {
    if (!isTauri() || !isMobile()) return null

    try {
        const { invoke } = await import('@tauri-apps/api/core')
        const token = await invoke<string | null>('read_fcm_token')
        return token ?? null
    } catch (error) {
        console.warn('[Notifications] Failed to read FCM token:', error)
        return null
    }
}

export async function registerDeviceTokenIfNeeded(userId: string): Promise<void> {
    if (!isSupabaseConfigured) return
    if (!isTauri() || !isMobile()) return

    const token = (await readAndroidFcmToken())?.trim() || ''
    if (!token) return

    const storageKey = `${TOKEN_STORAGE_KEY_PREFIX}:${userId}`
    const cached = localStorage.getItem(storageKey)
    if (cached === token) return

    const { error } = await supabase.functions.invoke('register-device-token', {
        body: { token, platform: 'android' }
    })

    if (error) {
        console.warn('[Notifications] Failed to register device token:', error)
        return
    }

    localStorage.setItem(storageKey, token)
}
