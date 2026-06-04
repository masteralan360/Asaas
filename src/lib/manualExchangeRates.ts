import type { ExchangeRateSource } from './exchangeRate'

export type ManualRateCurrency = 'USD' | 'EUR' | 'TRY'

type ManualRateConfig = {
    sourceKey: string
    rateKey: string
    expiresAtKey: string
    previousSourceKey: string
    defaultSource: Exclude<ExchangeRateSource, 'manual'>
}

const MANUAL_RATE_CONFIG: Record<ManualRateCurrency, ManualRateConfig> = {
    USD: {
        sourceKey: 'primary_exchange_rate_source',
        rateKey: 'manual_rate_usd_iqd',
        expiresAtKey: 'manual_rate_usd_iqd_expires_at',
        previousSourceKey: 'manual_rate_usd_iqd_previous_source',
        defaultSource: 'xeiqd'
    },
    EUR: {
        sourceKey: 'primary_eur_exchange_rate_source',
        rateKey: 'manual_rate_eur_iqd',
        expiresAtKey: 'manual_rate_eur_iqd_expires_at',
        previousSourceKey: 'manual_rate_eur_iqd_previous_source',
        defaultSource: 'forexfy'
    },
    TRY: {
        sourceKey: 'primary_try_exchange_rate_source',
        rateKey: 'manual_rate_try_iqd',
        expiresAtKey: 'manual_rate_try_iqd_expires_at',
        previousSourceKey: 'manual_rate_try_iqd_previous_source',
        defaultSource: 'forexfy'
    }
}

function getStorage() {
    return typeof window === 'undefined' ? null : window.localStorage
}

export function isManualRateCurrency(value: string | null | undefined): value is ManualRateCurrency {
    return value === 'USD' || value === 'EUR' || value === 'TRY'
}

export function getManualRateConfig(currency: ManualRateCurrency) {
    return MANUAL_RATE_CONFIG[currency]
}

export function getDefaultExchangeRateSource(currency: ManualRateCurrency) {
    return MANUAL_RATE_CONFIG[currency].defaultSource
}

export function clearManualRatePeriod(currency: ManualRateCurrency) {
    const storage = getStorage()
    if (!storage) return

    const config = getManualRateConfig(currency)
    storage.removeItem(config.expiresAtKey)
    storage.removeItem(config.previousSourceKey)
}

export function cleanupExpiredManualRate(currency: ManualRateCurrency, now = Date.now()) {
    const storage = getStorage()
    if (!storage) return false

    const config = getManualRateConfig(currency)
    const expiresAt = Number(storage.getItem(config.expiresAtKey) || 0)
    if (!expiresAt || expiresAt > now) {
        return false
    }

    const previousSource = storage.getItem(config.previousSourceKey)
    storage.setItem(
        config.sourceKey,
        previousSource && previousSource !== 'manual'
            ? previousSource
            : config.defaultSource
    )
    clearManualRatePeriod(currency)
    return true
}

export function cleanupExpiredManualRates(now = Date.now()) {
    let cleaned = false
    for (const currency of Object.keys(MANUAL_RATE_CONFIG) as ManualRateCurrency[]) {
        cleaned = cleanupExpiredManualRate(currency, now) || cleaned
    }
    return cleaned
}

export function getManualRateSource(currency: ManualRateCurrency): ExchangeRateSource {
    cleanupExpiredManualRate(currency)

    const storage = getStorage()
    if (!storage) return getDefaultExchangeRateSource(currency)

    return (storage.getItem(getManualRateConfig(currency).sourceKey) as ExchangeRateSource | null)
        || getDefaultExchangeRateSource(currency)
}

export function getManualRateValue(currency: ManualRateCurrency) {
    cleanupExpiredManualRate(currency)

    const storage = getStorage()
    if (!storage) return 0

    return parseInt(storage.getItem(getManualRateConfig(currency).rateKey) || '0')
}

export function setExchangeRateSource(currency: ManualRateCurrency, source: ExchangeRateSource) {
    const storage = getStorage()
    if (!storage) return

    const config = getManualRateConfig(currency)
    storage.setItem(config.sourceKey, source)
    if (source !== 'manual') {
        clearManualRatePeriod(currency)
    }
}

export function setManualExchangeRate(
    currency: ManualRateCurrency,
    rate: number,
    options?: { expiresAt?: number | string | Date }
) {
    const storage = getStorage()
    if (!storage) return

    const config = getManualRateConfig(currency)
    const currentSource = storage.getItem(config.sourceKey)
    const previousSource = currentSource && currentSource !== 'manual'
        ? currentSource
        : storage.getItem(config.previousSourceKey) || config.defaultSource

    storage.setItem(config.sourceKey, 'manual')
    storage.setItem(config.rateKey, String(Math.max(0, Math.round(rate))))

    if (options?.expiresAt) {
        const expiresAt = options.expiresAt instanceof Date
            ? options.expiresAt.getTime()
            : Number(options.expiresAt)
        storage.setItem(config.expiresAtKey, String(expiresAt))
        storage.setItem(config.previousSourceKey, previousSource)
    } else {
        clearManualRatePeriod(currency)
    }
}

export function clearManualExchangeRate(currency: ManualRateCurrency) {
    const storage = getStorage()
    if (!storage) return

    const config = getManualRateConfig(currency)
    storage.setItem(config.sourceKey, config.defaultSource)
    storage.removeItem(config.rateKey)
    clearManualRatePeriod(currency)
}
