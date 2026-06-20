import { describe, expect, it } from 'vitest'
import { canManageClinicalRegistryType } from '@/i18n/clinicalRegistry'
import {
    getClinicalRegistryPresetId,
    normalizeClinicalRegistryType,
} from '@/local-db/clinicalRegistryPreset'

describe('clinical registry preference', () => {
    it('uses a deterministic preset id for each workspace', () => {
        expect(getClinicalRegistryPresetId('workspace-a')).toBe(getClinicalRegistryPresetId('workspace-a'))
        expect(getClinicalRegistryPresetId('workspace-a')).not.toBe(getClinicalRegistryPresetId('workspace-b'))
    })

    it('defaults unsupported or missing preset values to medical', () => {
        expect(normalizeClinicalRegistryType('beauty')).toBe('beauty')
        expect(normalizeClinicalRegistryType('medical')).toBe('medical')
        expect(normalizeClinicalRegistryType('unknown')).toBe('medical')
        expect(normalizeClinicalRegistryType(undefined)).toBe('medical')
    })

    it('allows only admins with the clinical appointments workspace feature to manage the type', () => {
        expect(canManageClinicalRegistryType('admin', true)).toBe(true)
        expect(canManageClinicalRegistryType('admin', false)).toBe(false)
        expect(canManageClinicalRegistryType('staff', true)).toBe(false)
        expect(canManageClinicalRegistryType('viewer', true)).toBe(false)
    })
})
