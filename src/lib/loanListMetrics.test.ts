import { describe, expect, it } from 'vitest'

import {
    calculateInstallmentLoanListMetrics,
    calculateSimpleLoanListMetrics
} from './loanListMetrics'

const simpleLoan = (overrides: Record<string, unknown> = {}) => ({
    id: 'loan-1',
    principalAmount: 100,
    totalPaidAmount: 0,
    balanceAmount: 100,
    status: 'active',
    settlementCurrency: 'usd',
    ...overrides
}) as any

const installment = (overrides: Record<string, unknown> = {}) => ({
    loanId: 'loan-1',
    balanceAmount: 100,
    dueDate: '2026-09-09',
    status: 'unpaid',
    ...overrides
}) as any

describe('calculateSimpleLoanListMetrics', () => {
    it('summarizes principal, paid, and balance only for the loans visible in the filtered table', () => {
        const metrics = calculateSimpleLoanListMetrics([
            simpleLoan({ id: 'first', principalAmount: 0.1, totalPaidAmount: 0, balanceAmount: 0.1, settlementCurrency: 'usd' }),
            simpleLoan({ id: 'second', principalAmount: 0.2, totalPaidAmount: 0.1, balanceAmount: 0.1, settlementCurrency: 'usd' }),
            simpleLoan({ id: 'third', principalAmount: 300_000, totalPaidAmount: 50_000, balanceAmount: 250_000, settlementCurrency: 'iqd' })
        ], 'usd')

        expect(metrics).toEqual({
            totalPrincipalByCurrency: { usd: 0.3, iqd: 300_000 },
            totalPaidByCurrency: { usd: 0.1, iqd: 50_000 },
            totalBalanceByCurrency: { usd: 0.2, iqd: 250_000 },
            activeCount: 3
        })
    })

    it('keeps completed rows in the filtered total columns while excluding them from active entries', () => {
        const metrics = calculateSimpleLoanListMetrics([
            simpleLoan({ id: 'settled', principalAmount: 100, totalPaidAmount: 100, balanceAmount: 0, status: 'completed' }),
            simpleLoan({ id: 'completed-with-balance', principalAmount: 100, totalPaidAmount: 50, balanceAmount: 50, status: 'completed' }),
            simpleLoan({ id: 'active', principalAmount: 75, totalPaidAmount: 10, balanceAmount: 75, settlementCurrency: '' })
        ], 'iqd')

        expect(metrics).toEqual({
            totalPrincipalByCurrency: { usd: 200, iqd: 75 },
            totalPaidByCurrency: { usd: 150, iqd: 10 },
            totalBalanceByCurrency: { usd: 50, iqd: 75 },
            activeCount: 1
        })
    })
})

describe('calculateInstallmentLoanListMetrics', () => {
    it('includes installments only for rows visible in the filtered table', () => {
        const metrics = calculateInstallmentLoanListMetrics(
            [
                simpleLoan({ id: 'active', balanceAmount: 50, status: 'active' }),
                simpleLoan({ id: 'overdue', balanceAmount: 20, status: 'overdue' })
            ],
            [
                installment({ loanId: 'active', balanceAmount: 0.1, dueDate: '2026-09-09', status: 'unpaid' }),
                installment({ loanId: 'active', balanceAmount: 0.2, dueDate: '2026-09-09', status: 'partial' }),
                installment({ loanId: 'overdue', balanceAmount: 20, dueDate: '2026-09-08', status: 'unpaid' }),
                installment({ loanId: 'excluded-by-filter', balanceAmount: 999, dueDate: '2026-09-09', status: 'unpaid' }),
                installment({ loanId: 'active', balanceAmount: 100, dueDate: '2026-09-09', status: 'paid' })
            ],
            '2026-09-09',
            (loan) => loan.id === 'overdue'
        )

        expect(metrics).toEqual({
            totalOutstanding: 120.3,
            activeLoans: 1,
            overdueLoans: 1,
            dueToday: 0.3
        })
    })
})
