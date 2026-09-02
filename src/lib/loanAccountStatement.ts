import type { BusinessPartner, Loan, LoanDirection, LoanPayment } from '@/local-db'
import {
    buildPartnerAccountStatementLedger,
    type PartnerAccountStatementData
} from '@/lib/partnerAccountStatement'

export type LoanAccountStatementTotals = {
    debit: number
    credit: number
    balance: number
}

export type LoanAccountStatementPrintData = {
    partner: Pick<BusinessPartner, 'partnerName' | 'phone' | 'address'>
    loan: {
        id: string
        loanNo: string
        direction: LoanDirection
        settlementCurrency: Loan['settlementCurrency']
    }
    selectedPayment: Pick<LoanPayment, 'id' | 'amount' | 'paymentMethod' | 'paidAt' | 'note'>
    currency: Loan['settlementCurrency']
    previous: LoanAccountStatementTotals & {
        entryCount: number
    }
    repayment: LoanAccountStatementTotals & {
        date: string
        reference: string
    }
    totals: LoanAccountStatementTotals
    generatedAt: string
}

function summarizeEntries(entries: Array<{ delta: number }>, openingBalance: number): LoanAccountStatementTotals {
    let debit = 0
    let credit = 0
    let balance = openingBalance

    for (const entry of entries) {
        const delta = Number(entry.delta || 0)
        balance += delta
        if (delta > 0) debit += delta
        if (delta < 0) credit += Math.abs(delta)
    }

    return { debit, credit, balance }
}

/**
 * Creates a point-in-time partner statement for one loan repayment. The
 * selected repayment is split from the existing ordered partner ledger, so its
 * payment-transaction mirror can never be printed as a second ledger row.
 */
export function buildLoanAccountStatement(
    loan: Loan,
    partner: BusinessPartner,
    statementData: PartnerAccountStatementData,
    selectedPayment: LoanPayment
): LoanAccountStatementPrintData | null {
    const ledger = buildPartnerAccountStatementLedger(statementData).find((item) =>
        item.currency.toLowerCase() === loan.settlementCurrency.toLowerCase()
    )
    if (!ledger) return null

    const selectedEntryIndex = ledger.entries.findIndex((entry) =>
        entry.id === `loan-payment:${selectedPayment.id}`
        && entry.source?.recordType === 'loan'
        && entry.source?.recordId === loan.id
    )
    if (selectedEntryIndex < 0) return null

    const selectedEntry = ledger.entries[selectedEntryIndex]
    const previousEntries = ledger.entries.slice(0, selectedEntryIndex)
    const previous = summarizeEntries(previousEntries, ledger.openingBalance)
    const repayment = summarizeEntries([selectedEntry], previous.balance)

    return {
        partner: {
            partnerName: partner.partnerName,
            phone: partner.phone,
            address: partner.address
        },
        loan: {
            id: loan.id,
            loanNo: loan.loanNo,
            direction: loan.direction === 'borrowed' ? 'borrowed' : 'lent',
            settlementCurrency: loan.settlementCurrency
        },
        selectedPayment: {
            id: selectedPayment.id,
            amount: selectedPayment.amount,
            paymentMethod: selectedPayment.paymentMethod,
            paidAt: selectedPayment.paidAt,
            note: selectedPayment.note
        },
        currency: loan.settlementCurrency,
        previous: {
            ...previous,
            entryCount: previousEntries.length
        },
        repayment: {
            debit: repayment.debit,
            credit: repayment.credit,
            balance: repayment.balance,
            date: selectedEntry.date,
            reference: selectedEntry.reference
        },
        totals: {
            debit: previous.debit + repayment.debit,
            credit: previous.credit + repayment.credit,
            balance: repayment.balance
        },
        generatedAt: new Date().toISOString()
    }
}
