import { ReactQRCode } from '@lglab/react-qr-code'
import { useTranslation } from 'react-i18next'

import type { CurrencyCode, ExpenseItem, ExpenseSeries, IQDDisplayPreference, BudgetStatus } from '@/local-db'
import type { DividendItem, PayrollItem } from '@/lib/budget'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'

export interface BudgetExpensePrintRow {
    item: ExpenseItem
    series: ExpenseSeries | null
}

interface BudgetPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    monthLabel: string
    baseCurrency: CurrencyCode
    iqdPreference?: IQDDisplayPreference
    expenseRows: BudgetExpensePrintRow[]
    payrollItems: PayrollItem[]
    dividendItems: DividendItem[]
    metrics: {
        netProfitBase: number
        budgetLimitBase: number
        totalAllocatedBase: number
        totalPaidBase: number
        totalOutstandingBase: number
        operationalTotalBase: number
        operationalPaidBase: number
        payrollTotalBase: number
        payrollPaidBase: number
        surplusPoolBase: number
        dividendTotalBase: number
        surplusRemainderBase: number
        budgetUsageRatio: number
    }
    logoUrl?: string | null
    qrValue?: string | null
}

function isRTL(lang: string): boolean {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function statusLabel(status: BudgetStatus, t: (key: string, options?: Record<string, unknown>) => string): string {
    switch (status) {
        case 'paid':
            return t('budget.status.paid', { defaultValue: 'Paid' })
        case 'snoozed':
            return t('budget.status.snoozed', { defaultValue: 'Snoozed' })
        case 'pending':
        default:
            return t('budget.status.pending', { defaultValue: 'Pending' })
    }
}

function lockSuffix(isLocked: boolean | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
    return isLocked ? ` (${t('budget.print.locked', { defaultValue: 'Locked' })})` : ''
}

interface BudgetPrintHeaderProps {
    workspaceName?: string | null
    title: string
    subtitle: string
    logoUrl?: string | null
    qrValue?: string | null
}

function BudgetPrintHeader({
    workspaceName,
    title,
    subtitle,
    logoUrl,
    qrValue
}: BudgetPrintHeaderProps) {
    const logoSrc = resolveLogoSrc(logoUrl)

    return (
        <div className="border-b border-slate-300 pb-3 mb-4">
            <div className="flex items-start justify-between gap-3">
                <div className="w-1/3 flex flex-col items-start">
                    <div className="flex items-start w-full max-w-[180px]">
                        {logoSrc ? (
                            <img
                                src={logoSrc}
                                alt="Workspace Logo"
                                className="max-h-16 max-w-full object-contain object-left"
                            />
                        ) : (
                            <div className="h-10 flex items-center bg-gray-100 border border-gray-200 justify-center w-40 text-gray-400 font-bold tracking-wider uppercase">
                                LOGO
                            </div>
                        )}
                    </div>
                </div>

                <div className="w-1/3 flex justify-center pt-1">
                    {qrValue ? (
                        <div className="p-1.5 bg-white border border-slate-200 rounded" data-qr-sharp="true">
                            <ReactQRCode
                                value={qrValue}
                                size={64}
                                level="M"
                            />
                        </div>
                    ) : null}
                </div>

                <div className="w-1/3 flex flex-col items-center text-center">
                    <h1 className="text-xl font-bold">{workspaceName || 'Atlas'}</h1>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-[11px] text-slate-600">{subtitle}</p>
                </div>
            </div>
        </div>
    )
}

function SummaryBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-slate-300 rounded-md p-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 text-center">{label}</p>
            <p className="text-xs font-bold text-center">{value}</p>
        </div>
    )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
    return (
        <tr>
            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={colSpan}>
                {label}
            </td>
        </tr>
    )
}

export function BudgetPrintTemplate({
    workspaceName,
    printLang,
    monthLabel,
    baseCurrency,
    iqdPreference = 'IQD',
    expenseRows,
    payrollItems,
    dividendItems,
    metrics,
    logoUrl,
    qrValue
}: BudgetPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const noDataLabel = t('common.noData', { defaultValue: 'No data' })
    const formatBase = (amount: number) => formatCurrency(amount, baseCurrency, iqdPreference)
    const generatedAt = formatDateTime(new Date())

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

            <BudgetPrintHeader
                workspaceName={workspaceName}
                title={t('budget.print.title', { defaultValue: 'Accounting Report' })}
                subtitle={`${monthLabel} | ${t('sales.print.generated', { defaultValue: 'Generated' })}: ${generatedAt}`}
                logoUrl={logoUrl}
                qrValue={qrValue}
            />

            <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                <SummaryBox label={t('budget.netProfit', { defaultValue: 'Surplus' })} value={formatBase(metrics.netProfitBase)} />
                <SummaryBox label={t('budget.estimatedBudgetLimit', { defaultValue: 'Budget Limit' })} value={formatBase(metrics.budgetLimitBase)} />
                <SummaryBox label={t('budget.totalAllocated', { defaultValue: 'Total Allocated' })} value={formatBase(metrics.totalAllocatedBase)} />
                <SummaryBox label={t('budget.paid', { defaultValue: 'Total Paid' })} value={formatBase(metrics.totalPaidBase)} />
                <SummaryBox label={t('budget.pending', { defaultValue: 'Outstanding' })} value={formatBase(metrics.totalOutstandingBase)} />
                <SummaryBox label={t('budget.limit', { defaultValue: 'of budget' })} value={`${metrics.budgetUsageRatio.toFixed(1)}%`} />
                <SummaryBox label={t('budget.totalPool', { defaultValue: 'Total Distribution Pool' })} value={formatBase(metrics.surplusPoolBase)} />
                <SummaryBox label={t('budget.dividends', { defaultValue: 'Dividends' })} value={formatBase(metrics.dividendTotalBase)} />
                <SummaryBox label={t('budget.remainingAfterDivs', { defaultValue: 'Remaining After Distribution' })} value={formatBase(metrics.surplusRemainderBase)} />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5 text-xs">
                <div className="border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{t('budget.expenseList', { defaultValue: 'Monthly Expenses' })}</h2>
                    <p>{t('common.total', { defaultValue: 'Total' })}: {formatBase(metrics.operationalTotalBase)}</p>
                    <p>{t('budget.status.paid', { defaultValue: 'Paid' })}: {formatBase(metrics.operationalPaidBase)}</p>
                    <p>{t('budget.pending', { defaultValue: 'Outstanding' })}: {formatBase(metrics.operationalTotalBase - metrics.operationalPaidBase)}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{t('monthlyComparison.fallback.payroll', { defaultValue: 'Payroll' })}</h2>
                    <p>{t('common.total', { defaultValue: 'Total' })}: {formatBase(metrics.payrollTotalBase)}</p>
                    <p>{t('budget.status.paid', { defaultValue: 'Paid' })}: {formatBase(metrics.payrollPaidBase)}</p>
                    <p>{t('budget.pending', { defaultValue: 'Outstanding' })}: {formatBase(metrics.payrollTotalBase - metrics.payrollPaidBase)}</p>
                </div>
            </div>

            <h3 className="font-semibold mb-2 text-sm">{t('budget.expenseList', { defaultValue: 'Monthly Expenses' })}</h3>
            <table className="w-full border-collapse text-xs mb-5">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('common.description', { defaultValue: 'Description' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.category', { defaultValue: 'Category' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('common.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {expenseRows.length === 0 ? (
                        <EmptyRow colSpan={5} label={noDataLabel} />
                    ) : expenseRows.map(({ item, series }) => (
                        <tr key={item.id}>
                            <td className="border border-slate-300 p-2 font-medium">{series?.name || t('budget.deletedSeries', { defaultValue: 'Deleted Series' })}</td>
                            <td className="border border-slate-300 p-2 text-slate-600">
                                {series?.category || t('monthlyComparison.fallback.uncategorized', { defaultValue: 'Uncategorized' })}
                                {series?.subcategory ? ` / ${series.subcategory}` : ''}
                            </td>
                            <td className="border border-slate-300 p-2">{formatDate(item.dueDate)}</td>
                            <td className="border border-slate-300 p-2">{statusLabel(item.status, t)}{lockSuffix(item.isLocked, t)}</td>
                            <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(item.amount, item.currency, iqdPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h3 className="font-semibold mb-2 text-sm">{t('monthlyComparison.fallback.payroll', { defaultValue: 'Payroll' })}</h3>
            <table className="w-full border-collapse text-xs mb-5">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('admin.user', { defaultValue: 'User' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('admin.role', { defaultValue: 'Role' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('common.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {payrollItems.length === 0 ? (
                        <EmptyRow colSpan={5} label={noDataLabel} />
                    ) : payrollItems.map((item) => (
                        <tr key={item.employee.id}>
                            <td className="border border-slate-300 p-2 font-medium">{item.employee.name}</td>
                            <td className="border border-slate-300 p-2 text-slate-600">{item.employee.role || '-'}</td>
                            <td className="border border-slate-300 p-2">{formatDate(item.dueDate)}</td>
                            <td className="border border-slate-300 p-2">{statusLabel(item.status, t)}{lockSuffix(item.isLocked, t)}</td>
                            <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(item.amount, item.currency, iqdPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h3 className="font-semibold mb-2 text-sm">{t('budget.dividendsWithdrawal.title', { defaultValue: 'Dividends Withdrawal' })}</h3>
            <table className="w-full border-collapse text-xs">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('admin.user', { defaultValue: 'User' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.description', { defaultValue: 'Description' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                        <th className="border border-slate-300 p-2 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('common.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {dividendItems.length === 0 ? (
                        <EmptyRow colSpan={5} label={noDataLabel} />
                    ) : dividendItems.map((item) => (
                        <tr key={item.employee.id}>
                            <td className="border border-slate-300 p-2 font-medium">{item.employee.name}</td>
                            <td className="border border-slate-300 p-2 text-slate-600">
                                {item.type === 'percentage'
                                    ? `${item.employee.dividendAmount || 0}%`
                                    : t('budget.fixedDividend', { defaultValue: 'Fixed' })}
                            </td>
                            <td className="border border-slate-300 p-2">{formatDate(item.dueDate)}</td>
                            <td className="border border-slate-300 p-2">{statusLabel(item.status, t)}{lockSuffix(item.isLocked, t)}</td>
                            <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(item.amount, item.currency, iqdPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
