import { beforeEach, describe, expect, it } from 'vitest'

import {
    areApplicationUpdatesDisabled,
    setApplicationUpdatesDisabled,
    UPDATE_PREFERENCE_CHANGED_EVENT
} from './updatePreference'

function installBrowserStorage() {
    const rows = new Map<string, string>()
    const storage = {
        get length() {
            return rows.size
        },
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => rows.set(key, value),
        removeItem: (key: string) => rows.delete(key),
        clear: () => rows.clear(),
        key: (index: number) => Array.from(rows.keys())[index] ?? null,
    }
    const listeners = new Map<string, Set<(event: Event) => void>>()
    const windowStub = {
        localStorage: storage,
        addEventListener: (type: string, listener: (event: Event) => void) => {
            const entries = listeners.get(type) ?? new Set()
            entries.add(listener)
            listeners.set(type, entries)
        },
        removeEventListener: (type: string, listener: (event: Event) => void) => {
            listeners.get(type)?.delete(listener)
        },
        dispatchEvent: (event: Event) => {
            listeners.get(event.type)?.forEach((listener) => listener(event))
            return true
        },
    }

    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'CustomEvent', {
        configurable: true,
        value: class CustomEvent<T> extends Event {
            detail: T
            constructor(type: string, init?: CustomEventInit<T>) {
                super(type)
                this.detail = init?.detail as T
            }
        }
    })
}

describe('application update preference', () => {
    beforeEach(() => {
        installBrowserStorage()
    })

    it('defaults to allowing updates', () => {
        expect(areApplicationUpdatesDisabled()).toBe(false)
    })

    it('persists the preference and notifies active runtime guards', () => {
        let received: boolean | undefined
        window.addEventListener(UPDATE_PREFERENCE_CHANGED_EVENT, (event) => {
            received = (event as CustomEvent<{ disabled: boolean }>).detail.disabled
        })

        setApplicationUpdatesDisabled(true)

        expect(areApplicationUpdatesDisabled()).toBe(true)
        expect(localStorage.getItem('atlas_updates_disabled')).toBe('true')
        expect(received).toBe(true)
    })

    it('restores update checks when re-enabled', () => {
        setApplicationUpdatesDisabled(true)
        setApplicationUpdatesDisabled(false)

        expect(areApplicationUpdatesDisabled()).toBe(false)
    })
})
