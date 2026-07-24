import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import type { CurrencyCode, ExchangeRateSnapshot, OrderAdjustment, OrderAdjustmentType } from '@/local-db/models'
import { roundOrderValue } from '@/lib/orderPrecision'

export type OrderAdjustmentDraft = {
    id: string
    type: OrderAdjustmentType | ''
    name: string
    currency: CurrencyCode
    amount: string
}

function isAdjustmentType(value: unknown): value is OrderAdjustmentType {
    return value === 'addition' || value === 'deduction'
}

export function createOrderAdjustment(
    draft: OrderAdjustmentDraft,
    orderCurrency: CurrencyCode,
    exchangeRates?: ExchangeRateSnapshot[] | null
): OrderAdjustment | null {
    if (!isValidOrderAdjustmentDraft(draft)) return null

    const amount = Number(draft.amount)
    const conversion = getAppliedCurrencyConversion(amount, draft.currency, orderCurrency, exchangeRates)
    if (!conversion) return null

    return {
        id: draft.id,
        type: draft.type,
        name: draft.name.trim(),
        currency: draft.currency,
        amount: roundOrderValue(amount),
        orderCurrency,
        ...conversion
    }
}

/** Re-locks a confirmed adjustment when the order settlement currency changes. */
export function repriceOrderAdjustment(
    adjustment: OrderAdjustment,
    orderCurrency: CurrencyCode,
    exchangeRates?: ExchangeRateSnapshot[] | null
): OrderAdjustment | null {
    const conversion = getAppliedCurrencyConversion(adjustment.amount, adjustment.currency, orderCurrency, exchangeRates)
    if (!conversion) return null

    return {
        ...adjustment,
        orderCurrency,
        ...conversion
    }
}

/** Keeps persisted rows safe to display and calculate without re-pricing them. */
export function normalizeOrderAdjustments(value: unknown, orderCurrency: CurrencyCode): OrderAdjustment[] {
    if (!Array.isArray(value)) return []

    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const row = entry as Partial<OrderAdjustment>
        const amount = Number(row.amount)
        const convertedAmount = Number(row.convertedAmount)
        const exchangeRate = Number(row.exchangeRate)
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        const rowExchangeRates = Array.isArray(row.exchangeRates)
            ? row.exchangeRates.filter((rate): rate is ExchangeRateSnapshot => (
                !!rate
                && typeof rate.pair === 'string'
                && typeof rate.rate === 'number'
                && Number.isFinite(rate.rate)
                && rate.rate > 0
                && typeof rate.source === 'string'
                && typeof rate.timestamp === 'string'
            ))
            : []

        const hasValidBaseFields = (
            typeof row.id === 'string'
            && Boolean(row.id)
            && isAdjustmentType(row.type)
            && Boolean(name)
            && typeof row.currency === 'string'
            && Number.isFinite(amount)
            && amount > 0
        )
        if (!hasValidBaseFields) return []

        // Backward compatibility for already-saved single-currency rows.
        if (row.currency === orderCurrency && row.convertedAmount == null) {
            return [{
                id: row.id!,
                type: row.type!,
                name,
                currency: row.currency,
                amount: roundOrderValue(amount),
                orderCurrency,
                convertedAmount: roundOrderValue(amount),
                exchangeRate: 1,
                exchangeRateSource: 'native',
                exchangeRateTimestamp: new Date(0).toISOString(),
                exchangeRates: []
            }]
        }

        if (
            row.orderCurrency !== orderCurrency
            || !Number.isFinite(convertedAmount)
            || convertedAmount <= 0
            || !Number.isFinite(exchangeRate)
            || exchangeRate <= 0
            || typeof row.exchangeRateSource !== 'string'
            || !row.exchangeRateSource
            || typeof row.exchangeRateTimestamp !== 'string'
            || !row.exchangeRateTimestamp
            || !Array.isArray(row.exchangeRates)
            || (row.currency !== orderCurrency && rowExchangeRates.length === 0)
        ) {
            return []
        }

        return [{
            id: row.id,
            type: row.type,
            name,
            currency: row.currency,
            amount: roundOrderValue(amount),
            orderCurrency,
            convertedAmount: roundOrderValue(convertedAmount),
            exchangeRate: Math.round(exchangeRate * 10 ** 8) / 10 ** 8,
            exchangeRateSource: row.exchangeRateSource,
            exchangeRateTimestamp: row.exchangeRateTimestamp,
            exchangeRates: rowExchangeRates
        }]
    })
}

export function getOrderAdjustmentTotals(adjustments: OrderAdjustment[]) {
    const totals = adjustments.reduce((runningTotals, adjustment) => {
        if (adjustment.type === 'addition') runningTotals.additions += adjustment.convertedAmount
        else runningTotals.deductions += adjustment.convertedAmount
        return runningTotals
    }, { additions: 0, deductions: 0 })

    return {
        additions: roundOrderValue(totals.additions),
        deductions: roundOrderValue(totals.deductions)
    }
}

export function getOrderAdjustmentNetAmount(adjustments: OrderAdjustment[]) {
    const { additions, deductions } = getOrderAdjustmentTotals(adjustments)
    return roundOrderValue(additions - deductions)
}

export function calculateOrderTotalWithAdjustments(existingCalculatedTotal: number, adjustments: OrderAdjustment[]) {
    return roundOrderValue(existingCalculatedTotal + getOrderAdjustmentNetAmount(adjustments))
}

export function isValidOrderAdjustmentDraft(row: OrderAdjustmentDraft) {
    const amount = Number(row.amount)
    return Boolean(
        isAdjustmentType(row.type)
        && row.name.trim()
        && row.currency
        && Number.isFinite(amount)
        && amount > 0
    )
}
