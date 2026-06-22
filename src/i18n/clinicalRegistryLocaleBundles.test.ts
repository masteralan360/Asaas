import { describe, expect, it } from 'vitest'
import { getClinicalRegistryLocaleBundle } from '@/i18n/clinicalRegistryLocaleBundles'

function flattenKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [prefix]
    }

    return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) =>
        flattenKeys(nestedValue, prefix ? `${prefix}.${key}` : key),
    )
}

describe('clinical registry locale bundles', () => {
    it.each(['en', 'ku'] as const)('keeps complete key parity for the %s Beauty Center locale', (language) => {
        const medicalKeys = flattenKeys(getClinicalRegistryLocaleBundle(language, 'medical')).sort()
        const beautyKeys = flattenKeys(getClinicalRegistryLocaleBundle(language, 'beauty')).sort()

        expect(beautyKeys).toEqual(medicalKeys)
    })

    it('uses Beauty Center terminology throughout the English module', () => {
        const bundle = getClinicalRegistryLocaleBundle('en', 'beauty')

        expect(bundle.clinicalAppointments.title).toBe('Beauty Center Appointments')
        expect(bundle.clinicalAppointments.patient).toBe('Client')
        expect(bundle.clinicalAppointments.reasonForVisit).toBe('Requested Service')
        expect(bundle.clinicalAppointments.consultationFee).toBe('Service Fee')
        expect(bundle.clinicalPresets.title).toBe('Service Presets')
    })

    it('uses the original Beauty Center bundle for beauty2', () => {
        expect(getClinicalRegistryLocaleBundle('en', 'beauty2'))
            .toBe(getClinicalRegistryLocaleBundle('en', 'beauty'))
        expect(getClinicalRegistryLocaleBundle('ku', 'beauty2'))
            .toBe(getClinicalRegistryLocaleBundle('ku', 'beauty'))
    })

    it('falls back to the English Beauty Center bundle for Arabic', () => {
        expect(getClinicalRegistryLocaleBundle('ar', 'beauty'))
            .toBe(getClinicalRegistryLocaleBundle('en', 'beauty'))
    })
})
