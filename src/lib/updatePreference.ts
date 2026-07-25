const UPDATES_DISABLED_STORAGE_KEY = 'atlas_updates_disabled'

export const UPDATE_PREFERENCE_CHANGED_EVENT = 'atlas-updates-preference-changed'

function getStorage(): Storage | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null
    } catch {
        return null
    }
}

/**
 * Application updates are device-wide: a Tauri installation and a PWA service
 * worker cannot safely run a different binary/app shell for each workspace.
 * The setting is only exposed from Local Mode, where it is intentionally
 * persisted locally with the rest of the offline workspace state.
 */
export function areApplicationUpdatesDisabled(): boolean {
    return getStorage()?.getItem(UPDATES_DISABLED_STORAGE_KEY) === 'true'
}

export function setApplicationUpdatesDisabled(disabled: boolean): void {
    const storage = getStorage()
    if (storage) {
        storage.setItem(UPDATES_DISABLED_STORAGE_KEY, String(disabled))
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(UPDATE_PREFERENCE_CHANGED_EVENT, {
            detail: { disabled }
        }))
    }
}
