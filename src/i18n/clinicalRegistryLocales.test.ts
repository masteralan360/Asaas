import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { i18n as I18nInstance } from 'i18next'

let i18n: I18nInstance
let applyClinicalRegistryLocale: typeof import('@/i18n/clinicalRegistryLocales')['applyClinicalRegistryLocale']

beforeAll(async () => {
    const localStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    }

    vi.stubGlobal('window', {
        location: { hash: '' },
        localStorage,
    })
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('document', {
        dir: '',
        documentElement: {
            lang: '',
            dir: '',
        },
    })

    ;({ default: i18n } = await import('@/i18n/config'))
    ;({ applyClinicalRegistryLocale } = await import('@/i18n/clinicalRegistryLocales'))
})

afterAll(() => {
    vi.unstubAllGlobals()
})

describe('clinical registry locale synchronization', () => {
    it('applies English Beauty Center terminology while the app language is Arabic', async () => {
        await i18n.changeLanguage('ar')

        applyClinicalRegistryLocale('beauty')

        expect(i18n.t('clinicalAppointments.title')).toBe('Beauty Center Appointments')
        expect(i18n.t('clinicalAppointments.patient')).toBe('Client')
    })

    it('restores the original medical bundle', () => {
        applyClinicalRegistryLocale('medical')

        expect(i18n.t('clinicalAppointments.title')).toBe('سجل المواعيد السريرية')
        expect(i18n.t('clinicalAppointments.patient')).toBe('المريض')
    })

    it('applies the original Beauty Center terminology for beauty2', () => {
        applyClinicalRegistryLocale('beauty2')

        expect(i18n.t('clinicalAppointments.title')).toBe('Beauty Center Appointments')
        expect(i18n.t('clinicalAppointments.patient')).toBe('Client')
    })
})
