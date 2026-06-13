import { describe, expect, it } from 'vitest'

import type { OrderInstallment } from './models'
import {
    addOrderInstallmentDate,
    createOrderInstallmentPlan,
    rebuildOrderInstallmentsFromPayments
} from './orderInstallments'

function installment(overrides: Partial<OrderInstallment>): OrderInstallment {
    return {
        id: 'installment-1',
        workspaceId: 'workspace-1',
        orderType: 'sales',
        orderId: 'order-1',
        installmentNo: 1,
        dueDate: '2026-07-01',
        plannedAmount: 50,
        paidAmount: 0,
        balanceAmount: 50,
        status: 'unpaid',
        paidAt: null,
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
        syncStatus: 'synced',
        lastSyncedAt: '2026-06-13T00:00:00.000Z',
        version: 1,
        isDeleted: false,
        ...overrides
    }
}

describe('order installment schedules', () => {
    it('splits the balance without losing rounding remainders', () => {
        expect(createOrderInstallmentPlan(100, 'usd', 3, 'monthly', '2026-07-01')).toEqual([
            { installmentNo: 1, dueDate: '2026-07-01', plannedAmount: 33.33 },
            { installmentNo: 2, dueDate: '2026-08-01', plannedAmount: 33.33 },
            { installmentNo: 3, dueDate: '2026-09-01', plannedAmount: 33.34 }
        ])
    })

    it('keeps monthly dates in UTC and clamps end-of-month dates', () => {
        expect(addOrderInstallmentDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
        expect(addOrderInstallmentDate('2026-01-31', 'monthly', 2)).toBe('2026-03-31')
        expect(addOrderInstallmentDate('2026-07-01', 'weekly', 1)).toBe('2026-07-08')
    })

    it('allocates partial payments to the selected installment and then the next open one', () => {
        const rebuilt = rebuildOrderInstallmentsFromPayments(
            [
                installment({ id: 'installment-1', installmentNo: 1 }),
                installment({ id: 'installment-2', installmentNo: 2, dueDate: '2026-08-01' })
            ],
            [
                {
                    id: 'payment-1',
                    amount: 70,
                    paidAt: '2026-07-01T12:00:00.000Z',
                    targetInstallmentId: 'installment-1'
                }
            ],
            'usd',
            '2026-07-01T12:00:00.000Z'
        )

        expect(rebuilt[0]).toMatchObject({
            paidAmount: 50,
            balanceAmount: 0,
            status: 'paid',
            paidAt: '2026-07-01T12:00:00.000Z'
        })
        expect(rebuilt[1]).toMatchObject({
            paidAmount: 20,
            balanceAmount: 30,
            status: 'partial',
            paidAt: null
        })
    })
})
