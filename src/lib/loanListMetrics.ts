import type { Loan, LoanInstallment } from '@/local-db/models'

type LoanMetricInput = Pick<Loan, 'id' | 'principalAmount' | 'totalPaidAmount' | 'balanceAmount' | 'status' | 'settlementCurrency'>
type InstallmentMetricInput = Pick<LoanInstallment, 'loanId' | 'balanceAmount' | 'dueDate' | 'status'>

export type SimpleLoanListMetrics = {
    totalPrincipalByCurrency: Record<string, number>
    totalPaidByCurrency: Record<string, number>
    totalBalanceByCurrency: Record<string, number>
    activeCount: number
}

export type InstallmentLoanListMetrics = {
    totalOutstanding: number
    activeLoans: number
    overdueLoans: number
    dueToday: number
}

function addMetricAmount(total: number, amount: number) {
    // Loan amounts are persisted to a finite precision. Keep the summary free
    // of JavaScript floating-point residue while retaining that precision.
    return Math.round((total + amount + Number.EPSILON) * 1_000_000) / 1_000_000
}

/**
 * Calculates the simple-loan cards from the exact rows currently visible in
 * the table after its date, direction, payment, completion, and search
 * filters have been applied.
 */
export function calculateSimpleLoanListMetrics(
    visibleLoans: readonly LoanMetricInput[],
    defaultCurrency: string
): SimpleLoanListMetrics {
    const activeLoans = visibleLoans.filter((loan) => loan.balanceAmount > 0 && loan.status !== 'completed')
    const totalPrincipalByCurrency: Record<string, number> = {}
    const totalPaidByCurrency: Record<string, number> = {}
    const totalBalanceByCurrency: Record<string, number> = {}

    for (const loan of visibleLoans) {
        const currency = loan.settlementCurrency || defaultCurrency
        totalPrincipalByCurrency[currency] = addMetricAmount(totalPrincipalByCurrency[currency] || 0, loan.principalAmount)
        totalPaidByCurrency[currency] = addMetricAmount(totalPaidByCurrency[currency] || 0, loan.totalPaidAmount)
        totalBalanceByCurrency[currency] = addMetricAmount(totalBalanceByCurrency[currency] || 0, loan.balanceAmount)
    }

    return {
        totalPrincipalByCurrency,
        totalPaidByCurrency,
        totalBalanceByCurrency,
        activeCount: activeLoans.length
    }
}

/**
 * Calculates the installment-loan cards from the table's visible loans and
 * only the installments that belong to those loans.
 */
export function calculateInstallmentLoanListMetrics<TLoan extends LoanMetricInput>(
    visibleLoans: readonly TLoan[],
    dateScopedInstallments: readonly InstallmentMetricInput[],
    today: string,
    isOverdue: (loan: TLoan) => boolean
): InstallmentLoanListMetrics {
    const visibleLoanIds = new Set(visibleLoans.map((loan) => loan.id))
    const visibleInstallments = dateScopedInstallments.filter((item) => visibleLoanIds.has(item.loanId))

    return {
        totalOutstanding: visibleInstallments.reduce(
            (sum, item) => addMetricAmount(sum, item.balanceAmount),
            0
        ),
        activeLoans: visibleLoans.filter((loan) => loan.status === 'active' && loan.balanceAmount > 0).length,
        overdueLoans: visibleLoans.filter(isOverdue).length,
        dueToday: visibleInstallments
            .filter((item) => item.dueDate === today && item.balanceAmount > 0 && item.status !== 'paid')
            .reduce((sum, item) => addMetricAmount(sum, item.balanceAmount), 0)
    }
}
