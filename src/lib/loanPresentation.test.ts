import { describe, expect, it } from 'vitest'

import type { Loan } from '@/local-db/models'
import { getLoanPaymentStatus, matchesLoanPaymentFilter } from './loanPresentation'

type LoanPaymentFields = Pick<Loan, 'balanceAmount' | 'totalPaidAmount' | 'status'>

function loanPaymentFields(overrides: Partial<LoanPaymentFields> = {}): LoanPaymentFields {
    return {
        balanceAmount: 100,
        totalPaidAmount: 0,
        status: 'active',
        ...overrides,
    }
}

describe('loan payment filters', () => {
    it('classifies outstanding, partially paid, and paid loans', () => {
        expect(getLoanPaymentStatus(loanPaymentFields())).toBe('outstanding')
        expect(getLoanPaymentStatus(loanPaymentFields({ balanceAmount: 60, totalPaidAmount: 40 }))).toBe('partial')
        expect(getLoanPaymentStatus(loanPaymentFields({ balanceAmount: 0, totalPaidAmount: 100, status: 'completed' }))).toBe('paid')
    })

    it('treats the exact zero balance after rounded payments as paid', () => {
        expect(getLoanPaymentStatus(loanPaymentFields({ balanceAmount: 0.0001, totalPaidAmount: 99.9999 }))).toBe('partial')
        expect(getLoanPaymentStatus(loanPaymentFields({ balanceAmount: 0, totalPaidAmount: 100 }))).toBe('paid')
    })

    it('includes partially paid loans in the outstanding filter', () => {
        expect(matchesLoanPaymentFilter(loanPaymentFields(), 'outstanding')).toBe(true)
        expect(matchesLoanPaymentFilter(loanPaymentFields({ balanceAmount: 60, totalPaidAmount: 40 }), 'outstanding')).toBe(true)
        expect(matchesLoanPaymentFilter(loanPaymentFields({ balanceAmount: 0, totalPaidAmount: 100 }), 'outstanding')).toBe(false)
    })

    it('keeps cancelled loans out of payment-status filters while all includes every loan', () => {
        const cancelledLoan = loanPaymentFields({ balanceAmount: 0, totalPaidAmount: 0, status: 'cancelled' })

        expect(getLoanPaymentStatus(cancelledLoan)).toBe('cancelled')
        expect(matchesLoanPaymentFilter(cancelledLoan, 'all')).toBe(true)
        expect(matchesLoanPaymentFilter(cancelledLoan, 'outstanding')).toBe(false)
        expect(matchesLoanPaymentFilter(cancelledLoan, 'partial')).toBe(false)
        expect(matchesLoanPaymentFilter(cancelledLoan, 'paid')).toBe(false)
    })
})
