import { useTranslation } from 'react-i18next'

import type { IQDDisplayPreference } from '@/local-db'
import type { LoanAccountStatementPrintData } from '@/lib/loanAccountStatement'
import { cn, formatCurrency, formatDateTime } from '@/lib/utils'

type LoanAccountStatementPrintTemplateProps = {
    workspaceName?: string | null
    printLang: string
    data: LoanAccountStatementPrintData
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
}

function balanceClass(balance: number) {
    if (balance > 0.000001) return 'bg-emerald-50 font-bold text-emerald-700'
    if (balance < -0.000001) return 'bg-amber-50 font-bold text-amber-800'
    return 'font-bold text-slate-700'
}

export function LoanAccountStatementPrintTemplate({
    workspaceName,
    printLang,
    data,
    iqdPreference = 'IQD',
    logoUrl
}: LoanAccountStatementPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const isRtl = printLang.startsWith('ar') || printLang.startsWith('ku')
    const displayAmount = (amount: number) => formatCurrency(Math.abs(amount), data.currency, iqdPreference)
    const balanceLabel = data.totals.balance > 0.000001
        ? t('loans.accountStatement.dueFromPartner')
        : data.totals.balance < -0.000001
            ? t('loans.accountStatement.dueToPartner')
            : t('businessPartners.accountStatement.settled')
    const repaymentLabel = data.loan.direction === 'borrowed'
        ? t('loans.accountStatement.repaymentMade')
        : t('loans.accountStatement.repaymentReceived')

    return (
        <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm' }}
            data-loan-account-statement-print
            data-order-print-page
            data-page-width-mm="210"
            data-page-padding-mm="9"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-loan-account-statement-print] tr,
    [data-loan-account-statement-print] [data-pdf-keep-together] { break-inside: avoid; page-break-inside: avoid; }
    [data-loan-account-statement-print] thead { display: table-header-group; }
}
`
                }}
            />
            <section className="bg-white" style={{ minHeight: '297mm', padding: '9mm', boxSizing: 'border-box' }}>
                <header className="grid grid-cols-[1fr_1.55fr] gap-4 border-b-2 border-slate-800 pb-4" data-pdf-keep-together>
                    <div className="flex min-h-[31mm] items-center justify-center border-e border-slate-400 pe-4">
                        {logoUrl ? (
                            <img src={logoUrl} alt="" className="max-h-[28mm] max-w-[60mm] object-contain" />
                        ) : (
                            <div className="text-center text-[15px] font-bold">{workspaceName || ''}</div>
                        )}
                    </div>
                    <div className="space-y-1 text-[10px] leading-4">
                        <h1 className="text-[17px] font-bold">{t('loans.accountStatement.title')}</h1>
                        <div><span className="font-bold">{t('loans.accountStatement.partner')}:</span> {data.partner.partnerName}</div>
                        <div><span className="font-bold">{t('loans.accountStatement.loan')}:</span> {data.loan.loanNo}</div>
                        <div><span className="font-bold">{t('loans.accountStatement.repaymentDate')}:</span> {formatDateTime(data.selectedPayment.paidAt)}</div>
                        <div><span className="font-bold">{t('loans.accountStatement.paymentMethod')}:</span> {t(`pos.${data.selectedPayment.paymentMethod}`)}</div>
                    </div>
                </header>

                <div className="mt-3 grid grid-cols-3 gap-3 border-b border-slate-300 pb-3 text-[10px]" data-pdf-keep-together>
                    <div><span className="font-bold">{t('loans.accountStatement.currency')}:</span> {data.currency.toUpperCase()}</div>
                    <div><span className="font-bold">{t('loans.accountStatement.entriesSummarized')}:</span> {data.previous.entryCount}</div>
                    <div><span className="font-bold">{t('loans.accountStatement.printed')}:</span> {formatDateTime(data.generatedAt)}</div>
                </div>

                <table data-pdf-page-chunk className="mt-4 w-full table-fixed border-collapse text-[10px]">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="w-[16%] border border-slate-400 px-2 py-1.5 text-start">{t('common.date')}</th>
                            <th className="w-[22%] border border-slate-400 px-2 py-1.5 text-start">{t('common.reference')}</th>
                            <th className="w-[28%] border border-slate-400 px-2 py-1.5 text-start">{t('common.description')}</th>
                            <th className="w-[11%] border border-slate-400 px-2 py-1.5 text-end">{t('businessPartners.accountStatement.debit')}</th>
                            <th className="w-[11%] border border-slate-400 px-2 py-1.5 text-end">{t('businessPartners.accountStatement.credit')}</th>
                            <th className="w-[12%] border border-slate-400 px-2 py-1.5 text-end">{t('loans.accountStatement.balance')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr data-pdf-keep-together className="bg-slate-50">
                            <td className="border border-slate-300 px-2 py-2">-</td>
                            <td className="border border-slate-300 px-2 py-2">{data.loan.loanNo}</td>
                            <td className="border border-slate-300 px-2 py-2">
                                <div className="font-semibold">{t('loans.accountStatement.previousActivity')}</div>
                                <div className="mt-0.5 text-[8px] text-slate-600">{t('loans.accountStatement.previousActivityDescription')}</div>
                            </td>
                            <td className="border border-slate-300 px-2 py-2 text-end">{data.previous.debit ? displayAmount(data.previous.debit) : '-'}</td>
                            <td className="border border-slate-300 px-2 py-2 text-end">{data.previous.credit ? displayAmount(data.previous.credit) : '-'}</td>
                            <td className={cn('border border-slate-300 px-2 py-2 text-end', balanceClass(data.previous.balance))}>{displayAmount(data.previous.balance)}</td>
                        </tr>
                        <tr data-pdf-keep-together className="bg-sky-50/70">
                            <td className="border border-slate-300 px-2 py-2">{formatDateTime(data.repayment.date)}</td>
                            <td className="border border-slate-300 px-2 py-2 font-semibold">{data.repayment.reference}</td>
                            <td className="border border-slate-300 px-2 py-2">
                                <div className="font-semibold">{repaymentLabel}</div>
                                {data.selectedPayment.note?.trim() ? <div className="mt-0.5 text-[8px] text-slate-600">{data.selectedPayment.note}</div> : null}
                            </td>
                            <td className="border border-slate-300 px-2 py-2 text-end">{data.repayment.debit ? displayAmount(data.repayment.debit) : '-'}</td>
                            <td className="border border-slate-300 px-2 py-2 text-end">{data.repayment.credit ? displayAmount(data.repayment.credit) : '-'}</td>
                            <td className={cn('border border-slate-300 px-2 py-2 text-end', balanceClass(data.repayment.balance))}>{displayAmount(data.repayment.balance)}</td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr data-pdf-keep-together className="bg-slate-100 font-bold">
                            <td className="border border-slate-400 px-2 py-2" colSpan={3}>{t('loans.accountStatement.totalsThroughRepayment')}</td>
                            <td className="border border-slate-400 px-2 py-2 text-end">{data.totals.debit ? displayAmount(data.totals.debit) : '-'}</td>
                            <td className="border border-slate-400 px-2 py-2 text-end">{data.totals.credit ? displayAmount(data.totals.credit) : '-'}</td>
                            <td className={cn('border border-slate-400 px-2 py-2 text-end', balanceClass(data.totals.balance))}>{displayAmount(data.totals.balance)}</td>
                        </tr>
                    </tfoot>
                </table>

                <footer className="mt-5 flex items-center justify-between border-t border-slate-300 pt-2 text-[9px] text-slate-600" data-pdf-keep-together>
                    <span>{t('loans.accountStatement.balanceNote')}</span>
                    <span className={balanceClass(data.totals.balance)}>{balanceLabel}</span>
                </footer>
            </section>
        </div>
    )
}
