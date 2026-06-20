import i18n from '@/i18n/config'
import type { ClinicalRegistryType } from '@/i18n/clinicalRegistry'
import { getClinicalRegistryLocaleBundle } from '@/i18n/clinicalRegistryLocaleBundles'

export function applyClinicalRegistryLocale(registryType: ClinicalRegistryType): void {
    for (const language of ['en', 'ar', 'ku'] as const) {
        i18n.addResourceBundle(
            language,
            'translation',
            getClinicalRegistryLocaleBundle(language, registryType),
            true,
            true,
        )
    }

    i18n.emit('languageChanged', i18n.language)
}
