import type { i18n as I18n } from 'i18next'

export type ReturnReasonCode =
    | 'customer_returned'
    | 'wrong_item'
    | 'pricing_mistake'
    | 'damaged_product'
    | 'duplicate_sale'
    | 'other'

const RETURN_REASON_SUFFIX_BY_CODE: Record<ReturnReasonCode, string> = {
    customer_returned: 'customerReturned',
    wrong_item: 'wrongItem',
    pricing_mistake: 'pricingMistake',
    damaged_product: 'damagedProduct',
    duplicate_sale: 'duplicateSale',
    other: 'other'
}

const RETURN_REASON_FALLBACK_LABEL_BY_CODE: Record<ReturnReasonCode, string> = {
    customer_returned: 'Customer returned item',
    wrong_item: 'Wrong item sold',
    pricing_mistake: 'Pricing mistake',
    damaged_product: 'Damaged product',
    duplicate_sale: 'Duplicate sale',
    other: 'Other'
}

const RETURN_REASON_ALIAS_TO_CODE: Record<string, ReturnReasonCode> = {
    customer_returned: 'customer_returned',
    customerreturned: 'customer_returned',
    wrong_item: 'wrong_item',
    wrongitem: 'wrong_item',
    pricing_mistake: 'pricing_mistake',
    pricingmistake: 'pricing_mistake',
    damaged_product: 'damaged_product',
    damagedproduct: 'damaged_product',
    duplicate_sale: 'duplicate_sale',
    duplicatesale: 'duplicate_sale',
    other: 'other'
}

const KNOWN_REASON_LANGS = ['en', 'ar', 'ku'] as const
const RETURN_REASON_KEY_PREFIX = 'sales.return.reasons.'

function normalizeAlias(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(RETURN_REASON_KEY_PREFIX, '')
        .replace(/[\s.-]+/g, '_')
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function resolveKeyReasonCode(rawReason: string): ReturnReasonCode | undefined {
    if (!rawReason.startsWith(RETURN_REASON_KEY_PREFIX)) return undefined
    const suffix = rawReason.slice(RETURN_REASON_KEY_PREFIX.length)
    return RETURN_REASON_ALIAS_TO_CODE[normalizeAlias(suffix)]
}

function resolvePrintLang(lang: string): string {
    return (lang || 'en').split('-')[0]
}

export function resolveReturnReasonCode(rawReason: string | undefined, i18n: I18n): ReturnReasonCode | undefined {
    if (!rawReason) return undefined
    const trimmed = rawReason.trim()
    if (!trimmed) return undefined

    const keyReasonCode = resolveKeyReasonCode(trimmed)
    if (keyReasonCode) return keyReasonCode

    const aliasReasonCode = RETURN_REASON_ALIAS_TO_CODE[normalizeAlias(trimmed)]
    if (aliasReasonCode) return aliasReasonCode

    const normalizedLabel = normalizeLabel(trimmed)
    const reasonEntries = Object.entries(RETURN_REASON_SUFFIX_BY_CODE) as Array<[ReturnReasonCode, string]>

    for (const [reasonCode, reasonSuffix] of reasonEntries) {
        for (const lang of KNOWN_REASON_LANGS) {
            const localized = i18n.getFixedT(lang)(`${RETURN_REASON_KEY_PREFIX}${reasonSuffix}`)
            if (localized && localized !== `${RETURN_REASON_KEY_PREFIX}${reasonSuffix}` && normalizeLabel(localized) === normalizedLabel) {
                return reasonCode
            }
        }

        if (normalizeLabel(RETURN_REASON_FALLBACK_LABEL_BY_CODE[reasonCode]) === normalizedLabel) {
            return reasonCode
        }
    }

    return undefined
}

export function localizeReturnReason(
    rawReason: string | undefined,
    i18n: I18n,
    printLang: string,
    notProvidedLabel: string
): string {
    if (!rawReason || !rawReason.trim()) {
        return notProvidedLabel
    }

    const trimmed = rawReason.trim()
    const reasonCode = resolveReturnReasonCode(trimmed, i18n)
    if (!reasonCode) return trimmed

    const reasonKey = `${RETURN_REASON_KEY_PREFIX}${RETURN_REASON_SUFFIX_BY_CODE[reasonCode]}`
    const localized = i18n.getFixedT(resolvePrintLang(printLang))(reasonKey)

    if (localized && localized !== reasonKey) {
        return localized
    }

    return RETURN_REASON_FALLBACK_LABEL_BY_CODE[reasonCode]
}
