import { useTranslation } from 'react-i18next'

import type { BusinessPartnerRole, IQDDisplayPreference } from '@/local-db'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'

export type PartnerDetailsPrintTransactionSource =
    | 'sales_order'
    | 'purchase_order'
    | 'travel_sale'
    | 'loan'
    | 'simple_loan'
    | 'direct_transaction'

export type PartnerDetailsPrintData = {
    partner: {
        name: string
        role: BusinessPartnerRole
        contactName?: string
        email?: string
        phone?: string
        address?: string
        city?: string
        country?: string
        defaultCurrency: string
        createdAt: string
        notes?: string
        creditLimit: number
        receivableBalance: number
        payableBalance: number
        loanOutstandingBalance: number
        netExposure: number
    }
    period: {
        type: 'today' | 'month' | 'allTime' | 'custom'
        start?: string
        end?: string
    }
    generatedAt: string
    metrics: {
        totalValue: number
        outstandingValue: number
        averageDocumentValue: number
        activeItems: number
        completedItems: number
        settledItems: number
        totalUnits: number
        moneyIn: number
        moneyOut: number
    }
    transactions: Array<{
        id: string
        source: PartnerDetailsPrintTransactionSource
        reference: string
        displayDate: string
        status: string
        statusLabel: string
        isPaid: boolean
        summary: string
        total: number
        currency: string
    }>
    topProducts: Array<{
        id: string
        name: string
        quantity: number
        amount: number
    }>
}

interface PartnerDetailsPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    data: PartnerDetailsPrintData
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
}

function isRTL(lang: string) {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function resolveRoleLabel(role: BusinessPartnerRole, t: (key: string, options?: Record<string, unknown>) => string) {
    switch (role) {
        case 'customer':
            return t('customers.title', { defaultValue: 'Customer' })
        case 'supplier':
            return t('suppliers.title', { defaultValue: 'Supplier' })
        case 'buyer':
            return t('businessPartners.roles.buyer', { defaultValue: 'Buyer' })
        case 'seller':
            return t('businessPartners.roles.seller', { defaultValue: 'Seller' })
        default:
            return t('businessPartners.roles.both', { defaultValue: 'Both' })
    }
}

function resolveSourceLabel(
    source: PartnerDetailsPrintTransactionSource,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    switch (source) {
        case 'sales_order':
            return t('orders.tabs.sales', { defaultValue: 'Sales Order' })
        case 'purchase_order':
            return t('orders.tabs.purchase', { defaultValue: 'Purchase Order' })
        case 'travel_sale':
            return t('travelAgency.title', { defaultValue: 'Travel Sale' })
        case 'simple_loan':
            return t('loans.simpleTab', { defaultValue: 'Loans' })
        case 'direct_transaction':
            return t('ledger.type.direct_transaction', { defaultValue: 'Direct Transaction' })
        default:
            return t('loans.installmentLoan', { defaultValue: 'Installment Loan' })
    }
}

function resolvePeriodLabel(
    period: PartnerDetailsPrintData['period'],
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (period.type === 'today') {
        return t('performance.filters.today', { defaultValue: 'Today' })
    }
    if (period.type === 'month') {
        return t('performance.filters.thisMonth', { defaultValue: 'This Month' })
    }
    if (period.type === 'custom') {
        const start = period.start ? formatDate(period.start) : '-'
        const end = period.end ? formatDate(period.end) : '-'
        return `${start} - ${end}`
    }
    return t('performance.filters.allTime', { defaultValue: 'All Time' })
}

function ContactLine({ label, value }: { label: string; value?: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 py-1.5 last:border-0">
            <span className="text-slate-500">{label}</span>
            <span className="max-w-[65%] text-end font-medium">{value?.trim() || '-'}</span>
        </div>
    )
}

function MetricBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-slate-300 p-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-xs font-bold">{value}</div>
        </div>
    )
}

export function PartnerDetailsPrintTemplate({
    workspaceName,
    printLang,
    data,
    iqdPreference = 'IQD',
    logoUrl
}: PartnerDetailsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const logoSrc = resolveLogoSrc(logoUrl)
    const location = [data.partner.city, data.partner.country].filter(Boolean).join(', ')
    const recentTransactions = data.transactions.slice(0, 10)
    const hiddenTransactionCount = Math.max(0, data.transactions.length - recentTransactions.length)
    const periodLabel = resolvePeriodLabel(data.period, t)

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

            <div className="mb-4 border-b border-slate-300 pb-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="w-1/3">
                        {logoSrc ? (
                            <img
                                src={logoSrc}
                                alt=""
                                className="max-h-16 max-w-[180px] object-contain object-left"
                            />
                        ) : (
                            <div className="flex h-10 w-40 items-center justify-center border border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-400">
                                Logo
                            </div>
                        )}
                    </div>
                    <div className="w-2/3 text-end">
                        <h1 className="text-xl font-bold">{workspaceName || 'Atlas'}</h1>
                        <div className="mt-1 text-sm font-semibold">
                            {t('businessPartners.partnerDetailsPrint', { defaultValue: 'Partner Details' })}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                            {periodLabel} | {formatDateTime(data.generatedAt)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
                <div className="rounded-md border border-slate-300 p-3">
                    <div className="mb-2 border-b border-slate-200 pb-2">
                        <div className="text-base font-bold">{data.partner.name}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {resolveRoleLabel(data.partner.role, t)}
                        </div>
                    </div>
                    <ContactLine
                        label={t('businessPartners.form.contactName', { defaultValue: 'Contact Name' })}
                        value={data.partner.contactName}
                    />
                    <ContactLine label={t('common.phone', { defaultValue: 'Phone' })} value={data.partner.phone} />
                    <ContactLine label={t('common.email', { defaultValue: 'Email' })} value={data.partner.email} />
                    <ContactLine label={t('common.address', { defaultValue: 'Address' })} value={data.partner.address} />
                    <ContactLine label={t('common.location', { defaultValue: 'Location' })} value={location} />
                    <ContactLine
                        label={t('businessPartners.memberSince', { defaultValue: 'Partner Since' })}
                        value={formatDate(data.partner.createdAt)}
                    />
                </div>

                <div className="rounded-md border border-slate-300 p-3">
                    <div className="mb-2 border-b border-slate-200 pb-2 text-sm font-semibold">
                        {t('businessPartners.financialSummary', { defaultValue: 'Financial Summary' })}
                    </div>
                    <ContactLine
                        label={t('businessPartners.receivable', { defaultValue: 'Receivable' })}
                        value={formatCurrency(data.partner.receivableBalance, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.payable', { defaultValue: 'Payable' })}
                        value={formatCurrency(data.partner.payableBalance, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.loans', { defaultValue: 'Loans' })}
                        value={formatCurrency(data.partner.loanOutstandingBalance, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.netExposure', { defaultValue: 'Net Exposure' })}
                        value={formatCurrency(data.partner.netExposure, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.creditLimit', { defaultValue: 'Credit Limit' })}
                        value={formatCurrency(data.partner.creditLimit, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.balance', { defaultValue: 'Balance' })}
                        value={formatCurrency(
                            data.metrics.moneyIn - data.metrics.moneyOut,
                            data.partner.defaultCurrency,
                            iqdPreference
                        )}
                    />
                </div>
            </div>

            <div className="mb-4 grid grid-cols-4 gap-2">
                <MetricBox
                    label={t('businessPartners.totalValue', { defaultValue: 'Total Value' })}
                    value={formatCurrency(data.metrics.totalValue, data.partner.defaultCurrency, iqdPreference)}
                />
                <MetricBox
                    label={t('businessPartners.outstanding', { defaultValue: 'Outstanding' })}
                    value={formatCurrency(data.metrics.outstandingValue, data.partner.defaultCurrency, iqdPreference)}
                />
                <MetricBox
                    label={t('businessPartners.averageDocument', { defaultValue: 'Average Document' })}
                    value={formatCurrency(data.metrics.averageDocumentValue, data.partner.defaultCurrency, iqdPreference)}
                />
                <MetricBox
                    label={t('businessPartners.activeItems', { defaultValue: 'Active Items' })}
                    value={String(data.metrics.activeItems)}
                />
                <MetricBox
                    label={t('businessPartners.completedItems', { defaultValue: 'Completed Items' })}
                    value={String(data.metrics.completedItems)}
                />
                <MetricBox
                    label={t('businessPartners.settledItems', { defaultValue: 'Settled Items' })}
                    value={String(data.metrics.settledItems)}
                />
                <MetricBox
                    label={t('orders.details.units', { defaultValue: 'Units' })}
                    value={String(data.metrics.totalUnits)}
                />
                <MetricBox
                    label={t('businessPartners.cashFlow', { defaultValue: 'Cash Flow' })}
                    value={formatCurrency(
                        data.metrics.moneyIn - data.metrics.moneyOut,
                        data.partner.defaultCurrency,
                        iqdPreference
                    )}
                />
            </div>

            <div className="mb-4">
                <h2 className="mb-2 text-sm font-semibold">
                    {t('businessPartners.activityTimeline', { defaultValue: 'Unified Activity Timeline' })}
                </h2>
                <table className="w-full border-collapse text-[10px]">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="border border-slate-300 p-1.5 text-start">{t('common.type', { defaultValue: 'Type' })}</th>
                            <th className="border border-slate-300 p-1.5 text-start">{t('common.reference', { defaultValue: 'Reference' })}</th>
                            <th className="border border-slate-300 p-1.5 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                            <th className="border border-slate-300 p-1.5 text-start">{t('common.details', { defaultValue: 'Details' })}</th>
                            <th className="border border-slate-300 p-1.5 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                            <th className="border border-slate-300 p-1.5 text-end">{t('common.total', { defaultValue: 'Total' })}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recentTransactions.length === 0 ? (
                            <tr>
                                <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={6}>
                                    {t('businessPartners.noActivity', { defaultValue: 'No related activity yet.' })}
                                </td>
                            </tr>
                        ) : recentTransactions.map((transaction) => (
                            <tr key={transaction.id}>
                                <td className="border border-slate-300 p-1.5">{resolveSourceLabel(transaction.source, t)}</td>
                                <td className="border border-slate-300 p-1.5 font-semibold">{transaction.reference}</td>
                                <td className="border border-slate-300 p-1.5">{formatDate(transaction.displayDate)}</td>
                                <td className="border border-slate-300 p-1.5">{transaction.summary || '-'}</td>
                                <td className="border border-slate-300 p-1.5">
                                    {transaction.statusLabel}
                                    {' / '}
                                    {transaction.isPaid
                                        ? t('customers.details.paid', { defaultValue: 'Paid' })
                                        : t('customers.details.unpaid', { defaultValue: 'Unpaid' })}
                                </td>
                                <td className="border border-slate-300 p-1.5 text-end font-semibold">
                                    {formatCurrency(transaction.total, transaction.currency, iqdPreference)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {hiddenTransactionCount > 0 ? (
                    <div className="mt-1 text-end text-[9px] text-slate-500">
                        {t('businessPartners.moreActivities', {
                            defaultValue: '+{{count}} additional activities',
                            count: hiddenTransactionCount
                        })}
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                    <h2 className="mb-2 text-sm font-semibold">
                        {t('products.topProducts', { defaultValue: 'Top Products' })}
                    </h2>
                    <table className="w-full border-collapse text-[10px]">
                        <thead>
                            <tr className="bg-slate-100">
                                <th className="border border-slate-300 p-1.5 text-start">{t('common.name', { defaultValue: 'Name' })}</th>
                                <th className="border border-slate-300 p-1.5 text-end">{t('orders.details.units', { defaultValue: 'Units' })}</th>
                                <th className="border border-slate-300 p-1.5 text-end">{t('common.total', { defaultValue: 'Total' })}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.topProducts.length === 0 ? (
                                <tr>
                                    <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={3}>
                                        {t('common.noData', { defaultValue: 'No data' })}
                                    </td>
                                </tr>
                            ) : data.topProducts.map((product) => (
                                <tr key={product.id}>
                                    <td className="border border-slate-300 p-1.5">{product.name}</td>
                                    <td className="border border-slate-300 p-1.5 text-end">{product.quantity}</td>
                                    <td className="border border-slate-300 p-1.5 text-end">
                                        {formatCurrency(product.amount, data.partner.defaultCurrency, iqdPreference)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div>
                    <h2 className="mb-2 text-sm font-semibold">
                        {t('businessPartners.notes', { defaultValue: 'Notes' })}
                    </h2>
                    <div className="min-h-24 whitespace-pre-wrap break-words rounded-md border border-slate-300 p-3 text-[10px] text-slate-700">
                        {data.partner.notes?.trim() || '-'}
                    </div>
                </div>
            </div>
        </div>
    )
}
