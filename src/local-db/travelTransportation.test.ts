import { describe, expect, it } from 'vitest'

import {
    calculateTravelBookingAmounts,
    calculateTravelBookingPaymentState,
    getActiveTravelBookingPayments,
    TRAVEL_BOOKING_PAYMENT_SOURCE_TYPE
} from './travelTransportationCalculations'
import type { PaymentTransaction } from './models'

function payment(
    id: string,
    amount: number,
    reversalOfTransactionId: string | null = null,
    sourceType: PaymentTransaction['sourceType'] = TRAVEL_BOOKING_PAYMENT_SOURCE_TYPE
): PaymentTransaction {
    return {
        id,
        workspaceId: 'workspace-1',
        createdAt: '2026-09-04T10:00:00.000Z',
        updatedAt: '2026-09-04T10:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: '2026-09-04T10:00:00.000Z',
        version: 1,
        isDeleted: false,
        sourceModule: 'travel_transportation',
        sourceType,
        sourceRecordId: 'booking-1',
        sourceSubrecordId: id,
        direction: 'incoming',
        amount,
        currency: 'usd',
        paymentMethod: 'cash',
        paidAt: '2026-09-04T10:00:00.000Z',
        counterpartyName: null,
        referenceLabel: 'TT-2026-00001',
        note: null,
        createdBy: 'user-1',
        accountId: null,
        accountNameSnapshot: null,
        reversalOfTransactionId,
        metadata: { travelBookingId: 'booking-1' }
    }
}

describe('Travel & Transportation calculations and payment projections', () => {
    it('keeps Booking Total equal to passenger prices while storing confirmed adjustments as a separate amount', () => {
        const amounts = calculateTravelBookingAmounts(
            [{ price: 10.105 }, { price: 20.205 }],
            [{
                id: 'adjustment-1',
                type: 'addition',
                name: 'Visa fee',
                currency: 'usd',
                amount: 3.25,
                orderCurrency: 'usd',
                convertedAmount: 3.25,
                exchangeRate: 1,
                exchangeRateSource: 'native',
                exchangeRateTimestamp: '2026-09-04T10:00:00.000Z',
                exchangeRates: []
            }]
        )

        expect(amounts).toEqual({ passengerTotal: 30.31, bookingTotal: 30.31, adjustedBookingTotal: 33.56 })
    })

    it('reports Booked, Partially Paid, and Completed only from manual profit payment records', () => {
        expect(calculateTravelBookingPaymentState(100, [])).toMatchObject({
            paymentStatus: 'booked', paidProfitAmount: 0, outstandingProfitAmount: 100
        })
        expect(calculateTravelBookingPaymentState(100, [payment('payment-1', 40)])).toMatchObject({
            paymentStatus: 'partially_paid', paidProfitAmount: 40, outstandingProfitAmount: 60
        })
        expect(calculateTravelBookingPaymentState(100, [payment('payment-1', 40), payment('payment-2', 60)])).toMatchObject({
            paymentStatus: 'completed', paidProfitAmount: 100, outstandingProfitAmount: 0
        })
        expect(calculateTravelBookingPaymentState(0, [])).toMatchObject({
            paymentStatus: 'completed', paidProfitAmount: 0, outstandingProfitAmount: 0
        })
    })

    it('does not treat another source or a reversed profit payment as collected profit', () => {
        const rows = [
            payment('payment-1', 40),
            payment('payment-2', 60),
            payment('reversal-1', -40, 'payment-1'),
            payment('unrelated', 900, null, 'direct_transaction')
        ]

        expect(getActiveTravelBookingPayments(rows).map((item) => item.id)).toEqual(['payment-2'])
        expect(calculateTravelBookingPaymentState(100, rows)).toMatchObject({
            paymentStatus: 'partially_paid', paidProfitAmount: 60, outstandingProfitAmount: 40
        })
    })

    it('rounds decimal passenger and payment boundaries consistently', () => {
        expect(calculateTravelBookingAmounts([{ price: 0.1 }, { price: 0.2 }])).toMatchObject({ bookingTotal: 0.3 })
        expect(calculateTravelBookingPaymentState(0.3, [payment('payment-1', 0.1), payment('payment-2', 0.2)])).toMatchObject({
            paymentStatus: 'completed', paidProfitAmount: 0.3, outstandingProfitAmount: 0
        })
    })
})
