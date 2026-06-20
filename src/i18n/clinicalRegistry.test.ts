import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    canManageClinicalRegistryType,
    getClinicalRegistryStorageKey,
    getClinicalRegistryType,
    setClinicalRegistryType,
} from '@/i18n/clinicalRegistry'

describe('clinical registry preference', () => {
    const rows = new Map<string, string>()
    const dispatchEvent = vi.fn()

    beforeEach(() => {
        rows.clear()
        dispatchEvent.mockClear()

        vi.stubGlobal('CustomEvent', class {
            detail: unknown

            constructor(_type: string, init?: CustomEventInit) {
                this.detail = init?.detail
            }
        })
        vi.stubGlobal('window', {
            localStorage: {
                getItem: vi.fn((key: string) => rows.get(key) ?? null),
                setItem: vi.fn((key: string, value: string) => rows.set(key, value)),
            },
            dispatchEvent,
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('defaults to medical and scopes the saved type by workspace', () => {
        expect(getClinicalRegistryType('workspace-a')).toBe('medical')

        setClinicalRegistryType('workspace-a', 'beauty')

        expect(getClinicalRegistryStorageKey('workspace-a')).toBe('atlas_clinical_registry_type:workspace-a')
        expect(getClinicalRegistryType('workspace-a')).toBe('beauty')
        expect(getClinicalRegistryType('workspace-b')).toBe('medical')
        expect(dispatchEvent).toHaveBeenCalledOnce()
    })

    it('ignores unsupported stored values', () => {
        rows.set(getClinicalRegistryStorageKey('workspace-a'), 'unknown')

        expect(getClinicalRegistryType('workspace-a')).toBe('medical')
    })

    it('allows only admins with the clinical appointments workspace feature to manage the type', () => {
        expect(canManageClinicalRegistryType('admin', true)).toBe(true)
        expect(canManageClinicalRegistryType('admin', false)).toBe(false)
        expect(canManageClinicalRegistryType('staff', true)).toBe(false)
        expect(canManageClinicalRegistryType('viewer', true)).toBe(false)
    })
})
