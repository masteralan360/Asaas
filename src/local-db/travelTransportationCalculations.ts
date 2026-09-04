import { getOrderAdjustmentNetAmount } from '@/lib/orderAdjustments'
import { roundOrderValue } from '@/lib/orderPrecision'

import type { OrderAdjustment, PaymentTransaction, TravelBookingStatus, TravelPassenger } from './models'

export const TRAVEL_BOOKING_PAYMENT_SOURCE_TYPE = 'travel_booking_payment' as const
export const TRAVEL_BOOKING_PAYMENT_EPSILON = 0.0001

function roundAmount(value: number) {
    return roundOrderValue(Number.isFinite(value) ? value : 0)
}

export function calculateTravelBookingAmounts(
    passengers: ReadonlyArray<Pick<TravelPassenger, 'price'>>,
    adjustments: readonly OrderAdjustment[] = []
) {
    const passengerTotal = roundAmount(passengers.reduce((total, passenger) => total + Number(passenger.price || 0), 0))
    const bookingTotal = passengerTotal
    const adjustedBookingTotal = roundAmount(passengerTotal + getOrderAdjustmentNetAmount([...adjustments]))
    return { passengerTotal, bookingTotal, adjustedBookingTotal }
}

export function getActiveTravelBookingPayments(payments: readonly PaymentTransaction[]) {
    const reversedIds = new Set(payments
        .filter((payment) => !payment.isDeleted && Boolean(payment.reversalOfTransactionId))
        .map((payment) => payment.reversalOfTransactionId as string))
    return payments.filter((payment) => (
        !payment.isDeleted
        && !payment.reversalOfTransactionId
        && !reversedIds.has(payment.id)
        && payment.sourceType === TRAVEL_BOOKING_PAYMENT_SOURCE_TYPE
        && payment.amount > TRAVEL_BOOKING_PAYMENT_EPSILON
    ))
}

export function calculateTravelBookingPaymentState(
    profitAmount: number,
    payments: readonly PaymentTransaction[]
) {
    const safeProfit = roundAmount(Math.max(0, Number(profitAmount || 0)))
    const paidProfitAmount = roundAmount(getActiveTravelBookingPayments(payments)
        .reduce((total, payment) => total + payment.amount, 0))
    const outstandingProfitAmount = roundAmount(Math.max(0, safeProfit - paidProfitAmount))
    const paymentStatus: Extract<TravelBookingStatus, 'booked' | 'partially_paid' | 'completed'> = safeProfit <= TRAVEL_BOOKING_PAYMENT_EPSILON
        ? 'completed'
        : outstandingProfitAmount <= TRAVEL_BOOKING_PAYMENT_EPSILON
            ? 'completed'
            : paidProfitAmount > TRAVEL_BOOKING_PAYMENT_EPSILON
                ? 'partially_paid'
                : 'booked'

    return { profitAmount: safeProfit, paidProfitAmount, outstandingProfitAmount, paymentStatus }
}
