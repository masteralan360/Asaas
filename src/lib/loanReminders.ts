import type { Loan, LoanInstallment } from '@/local-db/models'

export interface LoanReminderItem {
    loanId: string
    loanNo: string
    borrowerName: string
    installmentId: string
    installmentNo: number
    dueDate: string
    overdueAmount: number
    overdueInstallmentCount: number
    balanceAmount: number
    settlementCurrency: Loan['settlementCurrency']
    loan: Loan
    snoozedAt?: string
}

export function buildOverdueLoanReminderItems(
    loans: Loan[],
    installments: LoanInstallment[]
): LoanReminderItem[] {
    const today = new Date().toISOString().slice(0, 10)
    const activeLoanById = new Map(
        loans
            .filter(loan => !loan.isDeleted && loan.balanceAmount > 0)
            .map(loan => [loan.id, loan] as const)
    )

    const grouped = new Map<string, Omit<LoanReminderItem, 'loan'>>()

    for (const installment of installments) {
        if (installment.isDeleted || installment.balanceAmount <= 0 || installment.status === 'paid') {
            continue
        }

        if (installment.dueDate >= today) {
            continue
        }

        const loan = activeLoanById.get(installment.loanId)
        if (!loan) {
            continue
        }

        const existing = grouped.get(loan.id)
        if (!existing) {
            grouped.set(loan.id, {
                loanId: loan.id,
                loanNo: loan.loanNo,
                borrowerName: loan.borrowerName,
                installmentId: installment.id,
                installmentNo: installment.installmentNo,
                dueDate: installment.dueDate,
                overdueAmount: installment.balanceAmount,
                overdueInstallmentCount: 1,
                balanceAmount: loan.balanceAmount,
                settlementCurrency: loan.settlementCurrency
            })
            continue
        }

        const shouldReplaceOldestInstallment =
            installment.dueDate < existing.dueDate ||
            (installment.dueDate === existing.dueDate && installment.installmentNo < existing.installmentNo)
        if (shouldReplaceOldestInstallment) {
            existing.dueDate = installment.dueDate
            existing.installmentId = installment.id
            existing.installmentNo = installment.installmentNo
        }
        existing.overdueAmount += installment.balanceAmount
        existing.overdueInstallmentCount += 1
        existing.balanceAmount = loan.balanceAmount
    }

    return Array.from(grouped.values())
        .map(item => ({
            ...item,
            loan: activeLoanById.get(item.loanId)!,
            snoozedAt: activeLoanById.get(item.loanId)?.overdueReminderSnoozedForDueDate === item.dueDate
                ? activeLoanById.get(item.loanId)?.overdueReminderSnoozedAt || undefined
                : undefined
        }))
        .sort((a, b) => {
            const dueDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
            if (dueDiff !== 0) {
                return dueDiff
            }

            return b.overdueAmount - a.overdueAmount
        })
}
