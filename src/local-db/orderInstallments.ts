import type {
    CurrencyCode,
    InstallmentFrequency,
    InstallmentStatus,
    OrderInstallment,
    OrderPaymentStatus,
    PurchaseOrder,
    SalesOrder
} from './models'
import { ORDER_AMOUNT_EPSILON, roundOrderValue } from '@/lib/orderPrecision'

export { ORDER_AMOUNT_EPSILON } from '@/lib/orderPrecision'

type OrderLike = Pick<SalesOrder | PurchaseOrder, 'total' | 'currency' | 'isPaid'> & {
    paidAmount?: number
    balanceAmount?: number
    paymentStatus?: OrderPaymentStatus
}

export type OrderPaymentAllocationInput = {
    id: string
    amount: number
    paidAt: string
    targetInstallmentId?: string | null
}

export function roundOrderAmount(value: number, _currency: CurrencyCode) {
    return roundOrderValue(value)
}

export function getOrderPaidAmount(order: OrderLike) {
    if (Number.isFinite(order.paidAmount)) {
        const paidAmount = roundOrderAmount(Math.max(0, Number(order.paidAmount)), order.currency)
        const total = roundOrderAmount(Math.max(0, Number(order.total || 0)), order.currency)
        const balanceAmount = Number.isFinite(order.balanceAmount)
            ? roundOrderAmount(Math.max(0, Number(order.balanceAmount)), order.currency)
            : null

        if (
            order.isPaid
            && balanceAmount !== null
            && balanceAmount <= ORDER_AMOUNT_EPSILON
            && Math.abs(paidAmount - total) > ORDER_AMOUNT_EPSILON
        ) {
            return total
        }

        return paidAmount
    }

    return order.isPaid ? roundOrderAmount(order.total, order.currency) : 0
}

export function getOrderBalanceAmount(order: OrderLike) {
    const total = roundOrderAmount(Math.max(0, Number(order.total || 0)), order.currency)
    const paidAmount = getOrderPaidAmount(order)
    const derivedBalance = roundOrderAmount(Math.max(total - paidAmount, 0), order.currency)

    if (Number.isFinite(order.balanceAmount)) {
        const storedBalance = roundOrderAmount(Math.max(0, Number(order.balanceAmount)), order.currency)
        return Math.abs(storedBalance - derivedBalance) > ORDER_AMOUNT_EPSILON
            ? derivedBalance
            : storedBalance
    }

    return derivedBalance
}

export function getOrderPaymentStatus(order: OrderLike): OrderPaymentStatus {
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'partial' || order.paymentStatus === 'unpaid') {
        return order.paymentStatus
    }

    const paidAmount = getOrderPaidAmount(order)
    if (paidAmount <= 0) return 'unpaid'
    if (paidAmount >= order.total) return 'paid'
    return 'partial'
}

export function addOrderInstallmentDate(firstDueDate: string, frequency: InstallmentFrequency, offset: number) {
    const [year, month, day] = firstDueDate.slice(0, 10).split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (frequency === 'daily') {
        date.setUTCDate(date.getUTCDate() + offset)
    } else if (frequency === 'weekly') {
        date.setUTCDate(date.getUTCDate() + (offset * 7))
    } else if (frequency === 'biweekly') {
        date.setUTCDate(date.getUTCDate() + (offset * 14))
    } else {
        const targetMonth = (month - 1) + offset
        const targetYear = year + Math.floor(targetMonth / 12)
        const normalizedMonth = ((targetMonth % 12) + 12) % 12
        const lastDayOfMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
        date.setUTCFullYear(targetYear, normalizedMonth, Math.min(day, lastDayOfMonth))
    }
    return date.toISOString().slice(0, 10)
}

export function computeOrderInstallmentStatus(
    dueDate: string,
    paidAmount: number,
    balanceAmount: number,
    today = new Date().toISOString().slice(0, 10)
): InstallmentStatus {
    if (balanceAmount <= 0) return 'paid'
    if (paidAmount > 0) return 'partial'
    return dueDate.slice(0, 10) < today ? 'overdue' : 'unpaid'
}

export function createOrderInstallmentPlan(
    balanceAmount: number,
    currency: CurrencyCode,
    installmentCount: number,
    installmentFrequency: InstallmentFrequency,
    firstDueDate: string
) {
    const safeCount = Math.max(1, Math.trunc(installmentCount || 1))
    const safeBalance = roundOrderAmount(Math.max(0, balanceAmount), currency)
    const baseAmount = roundOrderAmount(safeBalance / safeCount, currency)
    const plan: Array<{ installmentNo: number; dueDate: string; plannedAmount: number }> = []
    let accumulated = 0

    for (let index = 0; index < safeCount; index += 1) {
        const plannedAmount = index === safeCount - 1
            ? roundOrderAmount(safeBalance - accumulated, currency)
            : baseAmount
        accumulated = roundOrderAmount(accumulated + plannedAmount, currency)
        plan.push({
            installmentNo: index + 1,
            dueDate: addOrderInstallmentDate(firstDueDate, installmentFrequency, index),
            plannedAmount
        })
    }

    return plan
}

export function rebuildOrderInstallmentsFromPayments(
    installments: OrderInstallment[],
    payments: OrderPaymentAllocationInput[],
    currency: CurrencyCode,
    now = new Date().toISOString()
) {
    const today = now.slice(0, 10)
    const rebuilt = installments
        .slice()
        .sort((left, right) => left.installmentNo - right.installmentNo)
        .map((installment) => ({
            ...installment,
            paidAmount: 0,
            balanceAmount: roundOrderAmount(installment.plannedAmount, currency),
            status: computeOrderInstallmentStatus(installment.dueDate, 0, installment.plannedAmount, today),
            paidAt: null as string | null
        }))

    const sortedPayments = payments
        .slice()
        .sort((left, right) => left.paidAt.localeCompare(right.paidAt) || left.id.localeCompare(right.id))

    for (const payment of sortedPayments) {
        let remaining = roundOrderAmount(Math.max(0, payment.amount), currency)
        const paymentOrder = payment.targetInstallmentId
            ? [
                ...rebuilt.filter((item) => item.id === payment.targetInstallmentId),
                ...rebuilt.filter((item) => item.id !== payment.targetInstallmentId)
            ]
            : rebuilt

        for (const installment of paymentOrder) {
            if (remaining <= 0) break
            if (installment.balanceAmount <= 0) continue

            const applied = roundOrderAmount(Math.min(installment.balanceAmount, remaining), currency)
            installment.paidAmount = roundOrderAmount(installment.paidAmount + applied, currency)
            installment.balanceAmount = roundOrderAmount(Math.max(installment.balanceAmount - applied, 0), currency)
            installment.status = computeOrderInstallmentStatus(
                installment.dueDate,
                installment.paidAmount,
                installment.balanceAmount,
                today
            )
            installment.paidAt = installment.balanceAmount <= 0 ? payment.paidAt : null
            remaining = roundOrderAmount(Math.max(remaining - applied, 0), currency)
        }
    }

    return rebuilt.map((installment) => ({
        ...installment,
        status: computeOrderInstallmentStatus(
            installment.dueDate,
            installment.paidAmount,
            installment.balanceAmount,
            today
        )
    }))
}
