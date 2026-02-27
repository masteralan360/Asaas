import { Loan, LoanInstallment, LoanPayment } from '@/local-db'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

type LoanFilter = 'all' | 'active' | 'overdue' | 'completed'

interface LoanListPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    loans: Loan[]
    filter: LoanFilter
    displayCurrency: string
    iqdPreference?: 'IQD' | 'د.ع'
    metrics: {
        totalOutstanding: number
        activeLoans: number
        overdueLoans: number
        dueToday: number
    }
}

interface LoanDetailsPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    loan: Loan
    installments: LoanInstallment[]
    payments: LoanPayment[]
    iqdPreference?: 'IQD' | 'د.ع'
}

function isLoanOverdue(loan: Loan): boolean {
    if (loan.balanceAmount <= 0) return false
    if (loan.status === 'overdue') return true
    if (!loan.nextDueDate) return false
    return loan.nextDueDate < new Date().toISOString().slice(0, 10)
}

function isRTL(lang: string): boolean {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveStatusLabel(loan: Loan, t: (key: string) => string): string {
    if (isLoanOverdue(loan)) {
        return t('loans.statuses.overdue') || 'Overdue'
    }
    return t(`loans.statuses.${loan.status}`) || loan.status
}

function resolveInstallmentStatusLabel(status: LoanInstallment['status'], t: (key: string) => string): string {
    return t(`loans.installmentStatuses.${status}`) || status
}

export function LoanListPrintTemplate({
    workspaceName,
    printLang,
    loans,
    filter,
    displayCurrency,
    iqdPreference = 'IQD',
    metrics
}: LoanListPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)

    return (
        <div
            dir={isRTL(printLang) ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm', minHeight: '297mm', padding: '14mm 12mm' }}
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
}
`
                }}
            />

            <div className="border-b border-slate-300 pb-3 mb-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold">{workspaceName || 'Asaas'}</h1>
                        <p className="text-sm font-semibold">{t('nav.loans') || 'Loans'}</p>
                        <p className="text-[11px] text-slate-600">
                            {(t(`loans.filters.${filter}`) || filter)} • {formatDateTime(new Date().toISOString())}
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500">{t('loans.totalOutstanding') || 'Total Outstanding'}</p>
                    <p className="font-bold">{formatCurrency(metrics.totalOutstanding, displayCurrency as any, iqdPreference)}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500">{t('loans.dueToday') || 'Due Today'}</p>
                    <p className="font-bold">{formatCurrency(metrics.dueToday, displayCurrency as any, iqdPreference)}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500">{t('loans.activeLoans') || 'Active Loans'}</p>
                    <p className="font-bold">{metrics.activeLoans}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500">{t('loans.overdueLoans') || 'Overdue Loans'}</p>
                    <p className="font-bold">{metrics.overdueLoans}</p>
                </div>
            </div>

            <table className="w-full border-collapse text-xs">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('loans.loanNo') || 'Loan No.'}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('loans.borrower') || 'Borrower'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.principal') || 'Principal'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.paid') || 'Paid'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.balance') || 'Balance'}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('loans.nextDue') || 'Next Due'}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('loans.status') || 'Status'}</th>
                    </tr>
                </thead>
                <tbody>
                    {loans.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={7}>
                                {t('common.noData') || 'No data'}
                            </td>
                        </tr>
                    ) : loans.map((loan) => (
                        <tr key={loan.id}>
                            <td className="border border-slate-300 p-2 font-semibold">{loan.loanNo}</td>
                            <td className="border border-slate-300 p-2">
                                <p className="font-medium">{loan.borrowerName}</p>
                                <p className="text-[10px] text-slate-500">{loan.borrowerNationalId}</p>
                            </td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(loan.principalAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(loan.totalPaidAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(loan.balanceAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2">{loan.nextDueDate ? formatDate(loan.nextDueDate) : '-'}</td>
                            <td className="border border-slate-300 p-2">{resolveStatusLabel(loan, t)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export function LoanDetailsPrintTemplate({
    workspaceName,
    printLang,
    loan,
    installments,
    payments,
    iqdPreference = 'IQD'
}: LoanDetailsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)

    return (
        <div
            dir={isRTL(printLang) ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm', minHeight: '297mm', padding: '14mm 12mm' }}
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
}
`
                }}
            />

            <div className="border-b border-slate-300 pb-3 mb-4">
                <h1 className="text-xl font-bold">{workspaceName || 'Asaas'}</h1>
                <p className="text-sm font-semibold">{t('nav.loans') || 'Loans'}</p>
                <p className="text-[11px] text-slate-600">{loan.loanNo} • {formatDateTime(new Date().toISOString())}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                <div className="border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{t('loans.borrowerIdentity') || 'Borrower Identity'}</h2>
                    <p>{loan.borrowerName}</p>
                    <p>{loan.borrowerPhone}</p>
                    <p>{loan.borrowerAddress}</p>
                    <p className="text-slate-600">{loan.borrowerNationalId}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{t('loans.summary') || 'Loan Summary'}</h2>
                    <p>{t('loans.principal') || 'Principal'}: {formatCurrency(loan.principalAmount, loan.settlementCurrency, iqdPreference)}</p>
                    <p>{t('loans.paid') || 'Paid'}: {formatCurrency(loan.totalPaidAmount, loan.settlementCurrency, iqdPreference)}</p>
                    <p>{t('loans.balance') || 'Balance'}: {formatCurrency(loan.balanceAmount, loan.settlementCurrency, iqdPreference)}</p>
                    <p>{t('loans.nextDue') || 'Next Due'}: {loan.nextDueDate ? formatDate(loan.nextDueDate) : '-'}</p>
                    <p>{t('loans.status') || 'Status'}: {resolveStatusLabel(loan, t)}</p>
                </div>
            </div>

            <h3 className="font-semibold mb-2 text-sm">{t('loans.installmentSchedule') || 'Installment Schedule'}</h3>
            <table className="w-full border-collapse text-xs mb-5">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-end">#</th>
                        <th className="border border-slate-300 p-2 text-start">{t('loans.dueDate') || 'Due Date'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.planned') || 'Planned'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.paid') || 'Paid'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('loans.balance') || 'Balance'}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('loans.status') || 'Status'}</th>
                    </tr>
                </thead>
                <tbody>
                    {installments.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={6}>
                                {t('common.noData') || 'No data'}
                            </td>
                        </tr>
                    ) : installments.map((item) => (
                        <tr key={item.id}>
                            <td className="border border-slate-300 p-2">{String(item.installmentNo).padStart(2, '0')}</td>
                            <td className="border border-slate-300 p-2">{formatDate(item.dueDate)}</td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(item.plannedAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(item.paidAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(item.balanceAmount, loan.settlementCurrency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2">{resolveInstallmentStatusLabel(item.status, t)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h3 className="font-semibold mb-2 text-sm">{t('loans.recentActivity') || 'Recent Activity'}</h3>
            <table className="w-full border-collapse text-xs">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('common.date') || 'Date'}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.description') || 'Description'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('common.amount') || 'Amount'}</th>
                    </tr>
                </thead>
                <tbody>
                    {payments.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={3}>
                                {t('common.noData') || 'No data'}
                            </td>
                        </tr>
                    ) : payments
                        .slice()
                        .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
                        .map((payment) => (
                            <tr key={payment.id}>
                                <td className="border border-slate-300 p-2">{formatDate(payment.paidAt)}</td>
                                <td className="border border-slate-300 p-2">
                                    {t('loans.activities.paymentReceived') || 'Payment Received'}
                                </td>
                                <td className="border border-slate-300 p-2 text-end">
                                    {formatCurrency(payment.amount, loan.settlementCurrency, iqdPreference)}
                                </td>
                            </tr>
                        ))}
                </tbody>
            </table>
        </div>
    )
}
