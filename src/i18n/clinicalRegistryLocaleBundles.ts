import medicalEn from '@/i18n/locales/en.json'
import medicalAr from '@/i18n/locales/ar.json'
import medicalKu from '@/i18n/locales/ku.json'
import beautyEn from '@/i18n/locales/beauty-center/en.json'
import beautyKu from '@/i18n/locales/beauty-center/ku.json'
import type { ClinicalRegistryType } from '@/i18n/clinicalRegistry'
import { isBeautyClinicalRegistryType } from '@/local-db/clinicalRegistryPreset'

export type ClinicalRegistryLanguage = 'en' | 'ar' | 'ku'

function cloneBundle<T>(bundle: T): T {
    return JSON.parse(JSON.stringify(bundle)) as T
}

const medicalBundles = {
    en: cloneBundle({
        clinicalAppointments: medicalEn.clinicalAppointments,
        clinicalPresets: medicalEn.clinicalPresets,
    }),
    ar: cloneBundle({
        clinicalAppointments: medicalAr.clinicalAppointments,
        clinicalPresets: medicalAr.clinicalPresets,
    }),
    ku: cloneBundle({
        clinicalAppointments: medicalKu.clinicalAppointments,
        clinicalPresets: medicalKu.clinicalPresets,
    }),
} as const

const beautyEnBundle = cloneBundle(beautyEn)
const beautyKuBundle = cloneBundle(beautyKu)

const beautyBundles = {
    en: beautyEnBundle,
    ar: beautyEnBundle,
    ku: beautyKuBundle,
} as const

export function getClinicalRegistryLocaleBundle(
    language: ClinicalRegistryLanguage,
    registryType: ClinicalRegistryType,
) {
    return isBeautyClinicalRegistryType(registryType) ? beautyBundles[language] : medicalBundles[language]
}
