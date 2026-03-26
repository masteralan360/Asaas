import type { Loan, LoanCategory, LoanDirection } from '@/local-db/models'

type Translate = (key: string, options?: Record<string, unknown>) => string

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

export function isSimpleLoan(loan: Pick<Loan, 'loanCategory'> | null | undefined) {
    return getLoanCategory(loan) === 'simple'
}

export function getLoanDirectionLabel(direction: LoanDirection, t: Translate) {
    return translate(t, `loans.directions.${direction}`, direction === 'borrowed' ? 'Borrowed' : 'Lent')
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
