import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/local-db', () => ({}))

vi.mock('@/lib/loanParties', () => ({
    getLoanLinkedPartySummary: () => null
}))

vi.mock('@/lib/loanPresentation', () => ({
    getLoanCounterpartyLabel: () => 'Borrower',
    getLoanDirection: () => 'lent',
    getLoanDirectionLabel: () => 'Lent',
    getLoanIdentityTitle: () => 'Borrower Identity',
    getLoanModuleTitle: () => 'Loan Details',
    getLoanPaymentActivityLabel: () => 'Loan repayment',
    getLoanScheduleAmountLabel: () => 'Planned amount',
    getLoanScheduleIndexLabel: () => 'Installment',
    getLoanScheduleItemLabel: (_loan: unknown, installmentNo: number) => `Schedule #${installmentNo}`,
    getLoanScheduleTitle: () => 'Installment Schedule',
    getLoanSummaryTitle: () => 'Loan Summary',
    getSimpleLoanModuleTitle: () => 'Simple Loans',
    getStandardLoanModuleTitle: () => 'Loans',
    isSimpleLoan: () => false
}))

vi.mock('@/lib/utils', () => ({
    formatCurrency: (amount: number, currency: string) => `${amount} ${currency.toUpperCase()}`,
    formatDate: (value: string) => value,
    formatDateTime: (value: string) => value
}))

vi.mock('@/services/platformService', () => ({
    platformService: { convertFileSrc: (path: string) => path }
}))

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: {
            getFixedT: () => (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key
        }
    })
}))

vi.mock('@lglab/react-qr-code', () => ({
    ReactQRCode: () => null
}))

vi.mock('./LoanNoDisplay', () => ({
    LoanNoDisplay: ({ loanNo }: { loanNo: string }) => <span>{loanNo}</span>
}))

vi.mock('@/ui/components/print/HideablePrintFieldCard', () => ({
    HideablePrintFieldCard: ({ title }: { title: string }) => <div>{title}</div>
}))

import { LoanDetailsPrintTemplate, LoanListPrintTemplate } from './LoanPrintTemplates'

const loan = {
    id: 'loan-1',
    loanNo: 'LN-0001',
    borrowerName: 'Sample Borrower',
    borrowerPhone: '7500000000',
    borrowerAddress: 'Erbil',
    borrowerNationalId: 'NID-1',
    principalAmount: 1_000,
    totalPaidAmount: 500,
    balanceAmount: 500,
    settlementCurrency: 'usd',
    status: 'active',
    notes: 'Keep this note with the detailed document.'
} as any

describe('LoanDetailsPrintTemplate', () => {
    it('chunks long schedules and activity tables into A4-safe, labeled continuation tables', () => {
        const installments = Array.from({ length: 27 }, (_, index) => ({
            id: `installment-${index + 1}`,
            installmentNo: index + 1,
            dueDate: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
            plannedAmount: 100,
            paidAmount: 0,
            balanceAmount: 100,
            status: 'pending'
        })) as any
        const payments = Array.from({ length: 27 }, (_, index) => ({
            id: `payment-${index + 1}`,
            paidAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
            paymentMethod: 'cash',
            amount: 10
        })) as any

        const html = renderToStaticMarkup(createElement(LoanDetailsPrintTemplate, {
            workspaceName: 'Atlas',
            printLang: 'en',
            loan,
            installments,
            payments
        }))

        expect(html).toContain('data-loan-details-print="true"')
        expect(html).toContain('data-order-print-page="true"')
        expect(html).toContain('data-page-padding-mm="14"')
        expect(html.match(/data-pdf-page-chunk/g)).toHaveLength(6)
        expect(html.match(/data-centered-table/g)).toHaveLength(5)
        expect(html.match(/Installment Schedule/g)).toHaveLength(3)
        expect(html.match(/loans\.recentActivity/g)).toHaveLength(3)
        expect(html.match(/Schedule #/g)).toHaveLength(27)
        expect(html).toContain('Schedule #27')
        expect(html).toContain('2026-03-27T10:00:00.000Z')
        expect(html).toContain('(continued)')
    })

    it('keeps empty schedule and activity sections as page-safe tables', () => {
        const html = renderToStaticMarkup(createElement(LoanDetailsPrintTemplate, {
            printLang: 'en',
            loan,
            installments: [],
            payments: []
        }))

        expect(html.match(/data-pdf-page-chunk/g)).toHaveLength(2)
        expect(html.match(/data-centered-table/g)).toHaveLength(1)
        expect(html).toContain('common.noData')
    })
})

describe('LoanListPrintTemplate', () => {
    it('uses the shared A4 table pagination for the detailed full-page loans list', () => {
        const loans = Array.from({ length: 27 }, (_, index) => ({
            id: `loan-${index + 1}`,
            loanNo: `LN-${String(index + 1).padStart(4, '0')}`,
            borrowerName: `Counterparty ${index + 1}`,
            borrowerNationalId: `NID-${index + 1}`,
            principalAmount: 1_000,
            totalPaidAmount: 250,
            balanceAmount: 750,
            settlementCurrency: 'usd',
            nextDueDate: '2026-10-01',
            status: 'active'
        })) as any

        const html = renderToStaticMarkup(createElement(LoanListPrintTemplate, {
            workspaceName: 'Atlas',
            printLang: 'en',
            loans,
            filter: 'all',
            displayCurrency: 'usd',
            metrics: {
                totalOutstanding: 20_250,
                activeLoans: 27,
                overdueLoans: 0,
                dueToday: 0
            }
        }))

        expect(html).toContain('data-loan-list-print="true"')
        expect(html).toContain('data-order-print-page="true"')
        expect(html).toContain('data-page-padding-mm="14"')
        expect(html.match(/data-order-items-paginated/g)).toHaveLength(1)
        expect(html).toContain('data-order-items-title-text="Loans"')
        expect(html).toContain('data-order-items-continuation-label="(continued)"')
        expect(html).toContain('LN-0001')
        expect(html).toContain('LN-0027')
        expect(html).toContain('(continued)')
    })
})
