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

function isCurrencyCode(value: unknown): value is CurrencyCode {
    return value === 'usd' || value === 'eur' || value === 'iqd' || value === 'try'
}

type ValidOrderAdjustmentDraft = OrderAdjustmentDraft & {
    type: OrderAdjustmentType
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

        const id = typeof row.id === 'string' && row.id ? row.id : null
        const type = isAdjustmentType(row.type) ? row.type : null
        const currency = isCurrencyCode(row.currency) ? row.currency : null
        if (!id || !type || !name || !currency || !Number.isFinite(amount) || amount <= 0) return []

        // Backward compatibility for already-saved single-currency rows.
        if (currency === orderCurrency && row.convertedAmount == null) {
            return [{
                id,
                type,
                name,
                currency,
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
            || (currency !== orderCurrency && rowExchangeRates.length === 0)
        ) {
            return []
        }

        const scope = row.scope === 'post_return' && typeof row.returnId === 'string' && row.returnId
            ? 'post_return' as const
            : 'order' as const
        const notes = typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null
        const createdAt = typeof row.createdAt === 'string' && row.createdAt ? row.createdAt : null
        const createdBy = typeof row.createdBy === 'string' && row.createdBy ? row.createdBy : null

        return [{
            id,
            type,
            name,
            currency,
            amount: roundOrderValue(amount),
            orderCurrency,
            convertedAmount: roundOrderValue(convertedAmount),
            exchangeRate: Math.round(exchangeRate * 10 ** 8) / 10 ** 8,
            exchangeRateSource: row.exchangeRateSource,
            exchangeRateTimestamp: row.exchangeRateTimestamp,
            exchangeRates: rowExchangeRates,
            ...(scope === 'post_return' ? {
                scope,
                returnId: row.returnId as string,
                ...(notes ? { notes } : {}),
                ...(createdAt ? { createdAt } : {}),
                ...(createdBy ? { createdBy } : {})
            } : {})
        }]
    })
}

export function isPostReturnOrderAdjustment(adjustment: OrderAdjustment) {
    return adjustment.scope === 'post_return' && Boolean(adjustment.returnId)
}

/** Amount that changes the remaining order balance after a return. */
export function getPostReturnOrderAdjustmentNetAmount(adjustments: readonly OrderAdjustment[]) {
    return roundOrderValue(adjustments.reduce((total, adjustment) => {
        if (!isPostReturnOrderAdjustment(adjustment)) return total
        return total + (adjustment.type === 'addition'
            ? adjustment.convertedAmount
            : -adjustment.convertedAmount)
    }, 0))
}

/**
 * The persisted order total remains the value after item returns. Post-return
 * corrections are kept as immutable audit rows, so document totals apply them
 * at read/print time without rewriting the original return transaction.
 */
export function getOrderTotalWithPostReturnAdjustments(
    existingTotal: number,
    adjustments: readonly OrderAdjustment[]
) {
    return roundOrderValue(existingTotal + getPostReturnOrderAdjustmentNetAmount(adjustments))
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

export function isValidOrderAdjustmentDraft(row: OrderAdjustmentDraft): row is ValidOrderAdjustmentDraft {
    const amount = Number(row.amount)
    return Boolean(
        isAdjustmentType(row.type)
        && row.name.trim()
        && isCurrencyCode(row.currency)
        && Number.isFinite(amount)
        && amount > 0
    )
}
