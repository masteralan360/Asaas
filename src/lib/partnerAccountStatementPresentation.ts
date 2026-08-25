import type { i18n as I18n } from 'i18next'

import {
    getPartnerAccountStatementDescriptionTranslationKey,
    type PartnerAccountStatementEntry
} from '@/lib/partnerAccountStatement'
import { localizeReturnReason } from '@/lib/returnReasons'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Keeps the statement's language-independent event data separate from its
 * localized, user-facing wording. Both the on-screen statement and print
 * template use this so system identifiers are never rendered as descriptions.
 */
export function getPartnerAccountStatementEntryDescription(
    entry: Pick<PartnerAccountStatementEntry, 'description' | 'descriptionKey'>,
    t: Translate
) {
    const translationKey = getPartnerAccountStatementDescriptionTranslationKey(entry)
    return translationKey ? t(translationKey, { defaultValue: entry.description }) : entry.description
}

export function getPartnerAccountStatementEntryDetail(
    entry: Pick<PartnerAccountStatementEntry, 'note' | 'returnReason'>,
    options: { t: Translate; i18n: I18n; language: string }
) {
    if (entry.returnReason?.trim()) {
        const reason = localizeReturnReason(
            entry.returnReason,
            options.i18n,
            options.language,
            options.t('businessPartners.accountStatement.reasonNotProvided', { defaultValue: 'Not provided' })
        )
        return `${options.t('businessPartners.accountStatement.reason', { defaultValue: 'Reason' })}: ${reason}`
    }

    return entry.note?.trim() || null
}
