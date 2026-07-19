import { useTranslation } from 'react-i18next'

import type { BusinessPartnerRole, IQDDisplayPreference } from '@/local-db'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'

export type PartnerDetailsPrintTransactionSource =
    | 'sales_order'
    | 'purchase_order'
    | 'travel_sale'
    | 'loan'
    | 'simple_loan'
    | 'direct_transaction'
    | 'clinical_appointment'

export type PartnerDetailsPrintTransaction = {
    id: string
    source: PartnerDetailsPrintTransactionSource
    reference: string
    displayDate: string
    status: string
    statusLabel: string
    summary: string
    originalAmount: number
    paidAmount: number
    remainingAmount: number
    currency: string
}

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
    }
    period: {
        type: 'today' | 'month' | 'lastMonth' | 'allTime' | 'custom'
        start?: string
        end?: string
    }
    generatedAt: string
    loanSummary: {
        remainingReceivable: number
        remainingPayable: number
        paymentsReceived: number
        paymentsMade: number
    }
    metrics: {
        moneyIn: number
        moneyOut: number
    }
    relationshipSummary: {
        receivable: number
        payable: number
    }
    providedByYou: PartnerDetailsPrintTransaction[]
    providedByPartner: PartnerDetailsPrintTransaction[]
    salesOrders: PartnerDetailsPrintTransaction[]
    purchaseOrders: PartnerDetailsPrintTransaction[]
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
    showWhoOwesWhom?: boolean
    showOrders?: boolean
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
        case 'agent':
            return t('businessPartners.roles.agent', { defaultValue: 'Agent' })
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
        case 'clinical_appointment':
            return t('clinicalAppointments.title', { defaultValue: 'Appointment' })
        default:
            return t('loans.installmentRepayment', { defaultValue: 'Installment Repayment' })
    }
}

function resolvePeriodLabel(
    period: PartnerDetailsPrintData['period'],
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (period.start || period.end) {
        const start = period.start ? formatDate(period.start) : '-'
        const end = period.end ? formatDate(period.end) : '-'
        return t('businessPartners.fromDateToDate', {
            defaultValue: 'from {{start}} to {{end}}',
            start,
            end
        })
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

function MetricBox({ label, value, isRtl }: { label: string; value: string; isRtl: boolean }) {
    return (
        <div className="rounded-md border border-slate-300 p-2 text-center">
            <div className={cn('text-[10px] text-slate-500', !isRtl && 'uppercase tracking-wide')}>{label}</div>
            <div className="mt-1 text-xs font-bold">{value}</div>
        </div>
    )
}

function ActivityTable({
    title,
    rows,
    t,
    iqdPreference
}: {
    title: string
    rows: PartnerDetailsPrintTransaction[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    return (
        <div className="mb-4 break-inside-avoid">
            <h2 className="mb-2 text-sm font-semibold">{title}</h2>
            <table className="w-full border-collapse text-[9px]">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-1 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                        <th className="border border-slate-300 p-1 text-start">{t('common.type', { defaultValue: 'Type' })}</th>
                        <th className="border border-slate-300 p-1 text-start">{t('common.reference', { defaultValue: 'Reference' })}</th>
                        <th className="border border-slate-300 p-1 text-start">{t('common.details', { defaultValue: 'Details' })}</th>
                        <th className="border border-slate-300 p-1 text-end">{t('common.amount', { defaultValue: 'Amount' })}</th>
                        <th className="border border-slate-300 p-1 text-end">{t('common.paid', { defaultValue: 'Paid' })}</th>
                        <th className="border border-slate-300 p-1 text-end">{t('common.remaining', { defaultValue: 'Remaining' })}</th>
                        <th className="border border-slate-300 p-1 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={8}>
                                {t('businessPartners.noActivity', { defaultValue: 'No related activity yet.' })}
                            </td>
                        </tr>
                    ) : rows.map((transaction) => (
                        <tr key={transaction.id}>
                            <td className="border border-slate-300 p-1">{formatDate(transaction.displayDate)}</td>
                            <td className="border border-slate-300 p-1">{resolveSourceLabel(transaction.source, t)}</td>
                            <td className="border border-slate-300 p-1 font-semibold">{transaction.reference}</td>
                            <td className="border border-slate-300 p-1">{transaction.summary || '-'}</td>
                            <td className="border border-slate-300 p-1 text-end font-semibold">
                                {formatCurrency(transaction.originalAmount, transaction.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1 text-end font-semibold">
                                {formatCurrency(transaction.paidAmount, transaction.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1 text-end font-semibold">
                                {transaction.remainingAmount <= 0.001
                                    ? '\u2014'
                                    : formatCurrency(transaction.remainingAmount, transaction.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1">{transaction.statusLabel}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function OrderTable({
    title,
    rows,
    t,
    iqdPreference
}: {
    title: string
    rows: PartnerDetailsPrintTransaction[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    return (
        <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold">{title}</h2>
            <table className="w-full border-collapse text-[9px]">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-1.5 text-start">{t('common.date', { defaultValue: 'Date' })}</th>
                        <th className="border border-slate-300 p-1.5 text-start">{t('common.reference', { defaultValue: 'Reference' })}</th>
                        <th className="border border-slate-300 p-1.5 text-start">{t('common.details', { defaultValue: 'Details' })}</th>
                        <th className="border border-slate-300 p-1.5 text-end">{t('common.amount', { defaultValue: 'Amount' })}</th>
                        <th className="border border-slate-300 p-1.5 text-end">{t('common.paid', { defaultValue: 'Paid' })}</th>
                        <th className="border border-slate-300 p-1.5 text-end">{t('common.remaining', { defaultValue: 'Remaining' })}</th>
                        <th className="border border-slate-300 p-1.5 text-start">{t('common.status', { defaultValue: 'Status' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={7}>
                                {t('common.noData', { defaultValue: 'No data' })}
                            </td>
                        </tr>
                    ) : rows.map((order) => (
                        <tr key={order.id}>
                            <td className="border border-slate-300 p-1.5">{formatDate(order.displayDate)}</td>
                            <td className="border border-slate-300 p-1.5 font-semibold">{order.reference}</td>
                            <td className="border border-slate-300 p-1.5">{order.summary || '-'}</td>
                            <td className="border border-slate-300 p-1.5 text-end font-semibold">
                                {formatCurrency(order.originalAmount, order.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1.5 text-end font-semibold">
                                {formatCurrency(order.paidAmount, order.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1.5 text-end font-semibold">
                                {order.remainingAmount <= 0.001
                                    ? '\u2014'
                                    : formatCurrency(order.remainingAmount, order.currency, iqdPreference)}
                            </td>
                            <td className="border border-slate-300 p-1.5">{order.statusLabel}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export function PartnerDetailsPrintTemplate({
    workspaceName,
    printLang,
    data,
    iqdPreference = 'IQD',
    logoUrl,
    showWhoOwesWhom = true,
    showOrders = false
}: PartnerDetailsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const logoSrc = resolveLogoSrc(logoUrl)
    const location = [data.partner.city, data.partner.country].filter(Boolean).join(', ')
    const periodLabel = resolvePeriodLabel(data.period, t)
    const partnerRelationshipName = data.partner.contactName?.trim() || data.partner.name
    const workspaceRelationshipName = workspaceName?.trim()
        || t('businessPartners.ourBusiness', { defaultValue: 'Our business' })
    const isRtl = isRTL(printLang)

    return (
        <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm' }}
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

            <section
                className="bg-white"
                style={{ minHeight: '297mm', padding: '14mm 12mm', boxSizing: 'border-box' }}
            >
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
                        <div className={cn('text-[10px] font-semibold text-slate-500', !isRtl && 'uppercase tracking-wide')}>
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
                        label={t('businessPartners.remainingReceivableLoans', { defaultValue: 'Remaining Receivable Loans' })}
                        value={formatCurrency(data.loanSummary.remainingReceivable, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.remainingPayableLoans', { defaultValue: 'Remaining Payable Loans' })}
                        value={formatCurrency(data.loanSummary.remainingPayable, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.loanPaymentsReceivedInPeriod', {
                            defaultValue: 'Loan Payment Received By Us in ({{period}})',
                            period: periodLabel
                        })}
                        value={formatCurrency(data.loanSummary.paymentsReceived, data.partner.defaultCurrency, iqdPreference)}
                    />
                    <ContactLine
                        label={t('businessPartners.loanPaymentsMadeInPeriod', {
                            defaultValue: 'Loan Payment Made to the Partner in ({{period}})',
                            period: periodLabel
                        })}
                        value={formatCurrency(data.loanSummary.paymentsMade, data.partner.defaultCurrency, iqdPreference)}
                    />
                </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
                <MetricBox
                    label={t('businessPartners.incomingCash', { defaultValue: 'Incoming Cash' })}
                    value={formatCurrency(data.metrics.moneyIn, data.partner.defaultCurrency, iqdPreference)}
                    isRtl={isRtl}
                />
                <MetricBox
                    label={t('businessPartners.outgoingCash', { defaultValue: 'Outgoing Cash' })}
                    value={formatCurrency(data.metrics.moneyOut, data.partner.defaultCurrency, iqdPreference)}
                    isRtl={isRtl}
                />
                <MetricBox
                    label={t('ledger.netFlow', { defaultValue: 'Net Flow' })}
                    value={formatCurrency(
                        data.metrics.moneyIn - data.metrics.moneyOut,
                        data.partner.defaultCurrency,
                        iqdPreference
                    )}
                    isRtl={isRtl}
                />
            </div>

            {showWhoOwesWhom ? (
                <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 p-3">
                    <div className={cn('mb-2 text-xs font-semibold text-slate-600', !isRtl && 'uppercase tracking-wide')}>
                        {t('businessPartners.whoOwesWhom', { defaultValue: 'Who owes whom?' })}
                    </div>
                    <div className="grid gap-2">
                        {data.relationshipSummary.receivable > 0 ? (
                            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                                {t('businessPartners.owesAmountTo', {
                                    debtor: partnerRelationshipName,
                                    amount: formatCurrency(data.relationshipSummary.receivable, data.partner.defaultCurrency, iqdPreference),
                                    creditor: workspaceRelationshipName,
                                    defaultValue: '{{debtor}} owes {{amount}} to {{creditor}}'
                                })}
                            </div>
                        ) : null}
                        {data.relationshipSummary.payable > 0 ? (
                            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                                {t('businessPartners.owesAmountTo', {
                                    debtor: workspaceRelationshipName,
                                    amount: formatCurrency(data.relationshipSummary.payable, data.partner.defaultCurrency, iqdPreference),
                                    creditor: partnerRelationshipName,
                                    defaultValue: '{{debtor}} owes {{amount}} to {{creditor}}'
                                })}
                            </div>
                        ) : null}
                        {data.relationshipSummary.receivable <= 0 && data.relationshipSummary.payable <= 0 ? (
                            <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                {t('businessPartners.noOutstandingDebtBetween', {
                                    first: partnerRelationshipName,
                                    second: workspaceRelationshipName,
                                    defaultValue: '{{first}} and {{second}} do not owe each other anything.'
                                })}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <ActivityTable
                title={t('businessPartners.providedByYou', { defaultValue: 'What You Provided' })}
                rows={data.providedByYou}
                t={t}
                iqdPreference={iqdPreference}
            />
            <ActivityTable
                title={t('businessPartners.providedByPartner', { defaultValue: 'What the Partner Provided' })}
                rows={data.providedByPartner}
                t={t}
                iqdPreference={iqdPreference}
            />

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
            </section>

            {showOrders ? (
                <section
                    className="bg-white"
                    style={{
                        minHeight: '297mm',
                        padding: '14mm 12mm',
                        boxSizing: 'border-box',
                        breakBefore: 'page',
                        pageBreakBefore: 'always'
                    }}
                >
                    <div className="mb-5 border-b border-slate-300 pb-3">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-lg font-bold">{workspaceRelationshipName}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-600">
                                    {t('businessPartners.partnerOrders', { defaultValue: 'Partner Orders' })}
                                </div>
                            </div>
                            <div className="text-end">
                                <div className="text-sm font-bold">{data.partner.name}</div>
                                <div className="mt-1 text-[10px] text-slate-500">{periodLabel}</div>
                            </div>
                        </div>
                    </div>

                    <OrderTable
                        title={t('businessPartners.salesOrdersFromWorkspace', {
                            workspace: workspaceRelationshipName,
                            partner: partnerRelationshipName,
                            defaultValue: 'Sales from {{workspace}} to {{partner}}'
                        })}
                        rows={data.salesOrders}
                        t={t}
                        iqdPreference={iqdPreference}
                    />
                    <OrderTable
                        title={t('businessPartners.purchaseOrdersFromPartner', {
                            workspace: workspaceRelationshipName,
                            partner: partnerRelationshipName,
                            defaultValue: 'Purchases supplied by {{partner}} to {{workspace}}'
                        })}
                        rows={data.purchaseOrders}
                        t={t}
                        iqdPreference={iqdPreference}
                    />
                </section>
            ) : null}
        </div>
    )
}
