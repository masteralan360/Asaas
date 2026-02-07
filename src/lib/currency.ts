
export function convertToStoreBase(
    amount: number | undefined | null,
    from: string | undefined | null,
    baseCurrency: string,
    rates: {
        usd_iqd: number
        eur_iqd: number
        try_iqd: number
    }
) {
    if (!amount || isNaN(Number(amount))) return 0
    if (!from) return amount

    const fromCode = from.toLowerCase() as any
    const baseCode = baseCurrency.toLowerCase()
    if (fromCode === baseCode) return amount

    let inIQD = 0
    if (fromCode === 'usd') inIQD = amount * rates.usd_iqd
    else if (fromCode === 'eur') inIQD = amount * rates.eur_iqd
    else if (fromCode === 'try') inIQD = amount * rates.try_iqd
    else inIQD = amount

    if (baseCode === 'usd') return inIQD / rates.usd_iqd
    if (baseCode === 'eur') return inIQD / rates.eur_iqd
    if (baseCode === 'try') return inIQD / rates.try_iqd
    return inIQD
}
