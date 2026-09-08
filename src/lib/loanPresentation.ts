import type { Loan, LoanCategory, LoanDirection } from '@/local-db/models'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type LoanPaymentFilter = 'all' | 'outstanding' | 'partial' | 'paid'
export type LoanPaymentStatus = Exclude<LoanPaymentFilter, 'all'> | 'cancelled'

function translate(t: Translate, key: string, fallback: string) {
    const value = t(key, { defaultValue: fallback })
    return value === key ? fallback : value
}

export function getLoanCategory(loan: Pick<Loan, 'loanCategory'> | LoanCategory | null | undefined): LoanCategory {
    if (loan === 'simple' || (typeof loan === 'object' && loan?.loanCategory === 'simple')) {
        return 'simple'
    }

    return 'standard'
}

export function getLoanDirection(loan: Pick<Loan, 'direction'> | LoanDirection | null | undefined): LoanDirection {
    if (loan === 'borrowed' || (typeof loan === 'object' && loan?.direction === 'borrowed')) {
        return 'borrowed'
    }

    return 'lent'
}

export function getLoanPaymentStatus(loan: Pick<Loan, 'balanceAmount' | 'totalPaidAmount' | 'status'>): LoanPaymentStatus {
    if (loan.status === 'cancelled') return 'cancelled'
    if (loan.balanceAmount <= 0) return 'paid'
    return loan.totalPaidAmount > 0 ? 'partial' : 'outstanding'
}

export function matchesLoanPaymentFilter(
    loan: Pick<Loan, 'balanceAmount' | 'totalPaidAmount' | 'status'>,
    filter: LoanPaymentFilter
) {
    if (filter === 'all') return true

    const paymentStatus = getLoanPaymentStatus(loan)
    return filter === 'outstanding'
        ? paymentStatus === 'outstanding' || paymentStatus === 'partial'
        : paymentStatus === filter
}

export function isSimpleLoan(loan: Pick<Loan, 'loanCategory'> | null | undefined) {
    return getLoanCategory(loan) === 'simple'
}

export function getLoanDirectionLabel(direction: LoanDirection, t: Translate) {
    return translate(t, `loans.directions.${direction}`, direction === 'borrowed' ? 'Borrowed' : 'Lent')
}

export function getLoanSourceLabel(source: string | null | undefined, t: Translate) {
    if (source === 'order') return translate(t, 'loans.sources.order', 'Order')
    if (source === 'pos') return translate(t, 'loans.sources.pos', 'POS')
    return translate(t, 'loans.sources.manual', 'Manual')
}

export function getLoanCounterpartyLabel(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan) && getLoanDirection(loan) === 'borrowed') {
        return translate(t, 'loans.lender', 'Lender')
    }

    return translate(t, 'loans.borrower', 'Borrower')
}

export function getLoanCounterpartyNameLabel(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan) && getLoanDirection(loan) === 'borrowed') {
        return translate(t, 'loans.lenderName', 'Lender Name')
    }

    return translate(t, 'loans.borrowerName', 'Borrower Name')
}

export function getLoanIdentityTitle(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan) && getLoanDirection(loan) === 'borrowed') {
        return translate(t, 'loans.lenderIdentity', 'Lender Identity')
    }

    return translate(t, 'loans.borrowerIdentity', 'Borrower Identity')
}

export function getLoanDisbursementActivityLabel(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (!isSimpleLoan(loan)) {
        return translate(t, 'loans.activities.loanDisbursed', 'Loan Disbursed')
    }

    return getLoanDirection(loan) === 'borrowed'
        ? translate(t, 'loans.activities.amountBorrowed', 'Amount Borrowed')
        : translate(t, 'loans.activities.amountLent', 'Amount Lent')
}

export function getLoanPaymentActivityLabel(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (!isSimpleLoan(loan)) {
        return translate(t, 'loans.activities.paymentReceived', 'Payment Received')
    }

    return getLoanDirection(loan) === 'borrowed'
        ? translate(t, 'loans.activities.paymentMade', 'Repayment Made')
        : translate(t, 'loans.activities.paymentReceived', 'Payment Received')
}

export function getLoanRecordPaymentLabel(loan: Pick<Loan, 'loanCategory' | 'direction'> | null | undefined, t: Translate) {
    if (!isSimpleLoan(loan)) {
        return translate(t, 'loans.recordPayment', 'Record Payment')
    }

    return getLoanDirection(loan) === 'borrowed'
        ? translate(t, 'loans.recordRepayment', 'Record Repayment')
        : translate(t, 'loans.recordCollection', 'Record Collection')
}

export function getLoanDetailsTitle(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(t, 'loans.simpleLoanDetails', 'Simple Loan Details')
    }

    return translate(t, 'loans.details', 'Installment Loan Details')
}

export function getLoanSummaryTitle(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(t, 'loans.simpleLoanSummary', 'Simple Loan Summary')
    }

    return translate(t, 'loans.installmentLoanSummary', 'Installment Loan Summary')
}

export function getSimpleLoanModuleTitle(t: Translate) {
    return translate(t, 'nav.loans', translate(t, 'loans.simpleTab', 'Loans'))
}

export function getStandardLoanModuleTitle(t: Translate) {
    return translate(t, 'nav.installments', translate(t, 'loans.title', 'Installments'))
}

export function getLoanModuleTitle(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    return isSimpleLoan(loan) ? getSimpleLoanModuleTitle(t) : getStandardLoanModuleTitle(t)
}

export function getLoanListPath(loan: Pick<Loan, 'loanCategory'> | LoanCategory | null | undefined) {
    return getLoanCategory(loan) === 'simple' ? '/loans' : '/installments'
}

export function getLoanDetailsPath(
    loan: Pick<Loan, 'loanCategory'> | LoanCategory | null | undefined,
    loanId: string
) {
    return `${getLoanListPath(loan)}/${loanId}`
}

export function getLoanScheduleTitle(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(t, 'loans.loanEntries', 'Loans')
    }

    return translate(t, 'loans.installmentSchedule', 'Installment Schedule')
}

export function getLoanScheduleIndexLabel(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(t, 'loans.loanEntry', 'Loan')
    }

    return '#'
}

export function getLoanScheduleAmountLabel(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(t, 'common.amount', 'Amount')
    }

    return translate(t, 'loans.planned', 'Planned')
}

export function getLoanScheduleItemLabel(
    loan: Pick<Loan, 'loanCategory'> | null | undefined,
    installmentNo: number,
    t: Translate
) {
    const paddedInstallmentNo = String(installmentNo).padStart(2, '0')

    if (isSimpleLoan(loan)) {
        return `${getLoanScheduleIndexLabel(loan, t)} ${paddedInstallmentNo}`
    }

    return `#${paddedInstallmentNo}`
}

export function getLoanDeleteWarning(loan: Pick<Loan, 'loanCategory'> | null | undefined, t: Translate) {
    if (isSimpleLoan(loan)) {
        return translate(
            t,
            'loans.simpleDeleteWarning',
            'Deleting this loan will permanently remove the loan, its loan entries, and its payment history. This cannot be undone.'
        )
    }

    return translate(
        t,
        'loans.deleteWarning',
        'Deleting this loan will permanently remove the loan, its installment schedule, and its payment history. This cannot be undone.'
    )
}
