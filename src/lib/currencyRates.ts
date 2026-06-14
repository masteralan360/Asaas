import type { CurrencyCode, ExchangeRateSnapshot } from '@/local-db/models'

export interface RateEntry {
  rate: number
  source: string
  timestamp: string
}

export interface KnownRates {
  usdIqd: RateEntry | null
  eurIqd: RateEntry | null
  tryIqd: RateEntry | null
  usdEur?: RateEntry | null
  usdTry?: RateEntry | null
}

const ALL_CURRENCIES: CurrencyCode[] = ['usd', 'eur', 'iqd', 'try']

function baseRate(currency: CurrencyCode, rates: KnownRates): RateEntry | null {
  if (currency === 'usd') return rates.usdIqd
  if (currency === 'eur') return rates.eurIqd
  if (currency === 'try') return rates.tryIqd
  return null
}

export function computePairRate(
  from: CurrencyCode,
  to: CurrencyCode,
  rates: KnownRates,
): { rate: number; source: string; timestamp: string } | null {
  if (from === to) return null
  const now = new Date().toISOString()

  const direct = pairFromRates(from, to, rates)
  if (direct) return direct

  const fromIqd = baseRate(from, rates)
  const toIqd = baseRate(to, rates)
  if (fromIqd && toIqd && toIqd.rate > 0) {
    const crossRate = Math.round(fromIqd.rate / toIqd.rate * 10000) / 100
    return {
      rate: crossRate,
      source: `${fromIqd.source}/${toIqd.source}`,
      timestamp: now,
    }
  }

  return null
}

function pairFromRates(from: CurrencyCode, to: CurrencyCode, rates: KnownRates): { rate: number; source: string; timestamp: string } | null {
  if (from === 'usd' && to === 'iqd' && rates.usdIqd) return rates.usdIqd
  if (from === 'eur' && to === 'iqd' && rates.eurIqd) return rates.eurIqd
  if (from === 'try' && to === 'iqd' && rates.tryIqd) return rates.tryIqd
  if (from === 'usd' && to === 'eur' && rates.usdEur) return rates.usdEur
  if (from === 'usd' && to === 'try' && rates.usdTry) return rates.usdTry

  if (from === 'iqd' && to === 'usd' && rates.usdIqd) {
    return rates.usdIqd.rate > 0
      ? { rate: Math.round(1000000 / rates.usdIqd.rate), source: rates.usdIqd.source, timestamp: rates.usdIqd.timestamp }
      : null
  }
  if (from === 'iqd' && to === 'eur' && rates.eurIqd) {
    return rates.eurIqd.rate > 0
      ? { rate: Math.round(1000000 / rates.eurIqd.rate), source: rates.eurIqd.source, timestamp: rates.eurIqd.timestamp }
      : null
  }
  if (from === 'iqd' && to === 'try' && rates.tryIqd) {
    return rates.tryIqd.rate > 0
      ? { rate: Math.round(1000000 / rates.tryIqd.rate), source: rates.tryIqd.source, timestamp: rates.tryIqd.timestamp }
      : null
  }
  if (from === 'eur' && to === 'usd' && rates.usdEur) {
    return rates.usdEur.rate > 0
      ? { rate: Math.round(1000000 / rates.usdEur.rate), source: rates.usdEur.source, timestamp: rates.usdEur.timestamp }
      : null
  }
  if (from === 'try' && to === 'usd' && rates.usdTry) {
    return rates.usdTry.rate > 0
      ? { rate: Math.round(1000000 / rates.usdTry.rate), source: rates.usdTry.source, timestamp: rates.usdTry.timestamp }
      : null
  }

  const fromIqd = baseRate(from, rates)
  const toIqd = baseRate(to, rates)
  if (fromIqd && toIqd && toIqd.rate > 0) {
    const crossRate = Math.round(fromIqd.rate / toIqd.rate * 10000) / 100
    return {
      rate: crossRate,
      source: `${fromIqd.source}/${toIqd.source}`,
      timestamp: new Date().toISOString(),
    }
  }

  return null
}

function buildSnapshotForPair(
  from: CurrencyCode,
  to: CurrencyCode,
  rates: KnownRates,
): ExchangeRateSnapshot | null {
  if (from === to) return null
  const computed = computePairRate(from, to, rates)
  if (!computed) return null
  return {
    pair: `${from.toUpperCase()}/${to.toUpperCase()}`,
    rate: computed.rate,
    source: computed.source,
    timestamp: computed.timestamp,
  }
}

export function buildCheckoutRatesSnapshot(
  itemCurrencies: Set<CurrencyCode>,
  settlementCurrency: CurrencyCode,
  rates: KnownRates,
): ExchangeRateSnapshot[] {
  const snapshot: ExchangeRateSnapshot[] = []
  const now = new Date().toISOString()

  for (const itemCurrency of itemCurrencies) {
    if (itemCurrency === settlementCurrency) continue
    const entry = buildSnapshotForPair(itemCurrency, settlementCurrency, rates)
    if (entry) snapshot.push(entry)
  }

  if (snapshot.length === 0 && itemCurrencies.size > 0) {
    const firstCurrency = itemCurrencies.values().next().value
    if (firstCurrency) {
      const entry = buildSnapshotForPair(firstCurrency, 'iqd', rates)
      if (entry) snapshot.push(entry)
    }
  }

  return snapshot
}

export function getPrimaryCheckoutRate(
  itemCurrencies: Set<CurrencyCode>,
  settlementCurrency: CurrencyCode,
  rates: KnownRates,
): { rate: number; source: string; timestamp: string } | null {
  for (const itemCurrency of itemCurrencies) {
    if (itemCurrency === settlementCurrency) continue
    const computed = computePairRate(itemCurrency, settlementCurrency, rates)
    if (computed) return computed
  }

  for (const itemCurrency of itemCurrencies) {
    const computed = computePairRate(itemCurrency, 'iqd', rates)
    if (computed) return computed
  }

  return null
}
