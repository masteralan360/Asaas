import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'

import type { ActivityTransaction, ActivityTransactionLine, IQDDisplayPreference, WorkspacePaymentMethod } from '@/local-db/models'
import { formatCurrency } from '@/lib/utils'
import { platformService } from '@/services/platformService'

export type ActivityReceiptLabels = {
    activityReceipt: string
    priceOverridden: string
    customer: string
    status: string
    statusValue: string
    paymentMethod: string
    activity: string
    quantity: string
    unitPrice: string
    total: string
    madeby: string
}

function statusLabel(status: ActivityTransaction['status'], t: TFunction) {
    return t(`activities.status.${status}`, { defaultValue: status })
}

function paymentMethodLabel(paymentMethod: WorkspacePaymentMethod, t: TFunction) {
    return t(`activities.paymentMethods.${paymentMethod}`, {
        defaultValue: paymentMethod.replace(/_/g, ' ')
    })
}

function resolveWorkspaceLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return /^(https?:|data:|blob:)/i.test(logoUrl) ? logoUrl : platformService.convertFileSrc(logoUrl)
}

export function createActivityReceiptLabels(transaction: ActivityTransaction, t: TFunction): ActivityReceiptLabels {
    return {
        activityReceipt: t('activities.receiptTitle', { defaultValue: 'Activity receipt' }),
        priceOverridden: t('activities.priceOverridden', { defaultValue: 'Price overridden' }),
        customer: t('activities.customer', { defaultValue: 'Customer' }),
        status: t('activities.statusLabel', { defaultValue: 'Status' }),
        statusValue: statusLabel(transaction.status, t),
        paymentMethod: paymentMethodLabel(transaction.paymentMethod, t),
        activity: t('activities.activity', { defaultValue: 'Activity' }),
        quantity: t('activities.quantity', { defaultValue: 'Qty' }),
        unitPrice: t('activities.unitPrice', { defaultValue: 'Unit price' }),
        total: t('activities.total', { defaultValue: 'Total' }),
        madeby: t('common.madeBy', { defaultValue: 'Made by AtlasERP' })
    }
}

export function ActivityReceiptPrintTemplate({
    transaction,
    lines,
    infiniteActivityIds,
    workspaceName,
    logoUrl,
    iqdDisplayPreference,
    labels,
    locale
}: {
    transaction: ActivityTransaction
    lines: ActivityTransactionLine[]
    infiniteActivityIds: ReadonlySet<string>
    workspaceName: string
    logoUrl: string | null
    iqdDisplayPreference: IQDDisplayPreference
    labels: ActivityReceiptLabels
    locale: string
}): ReactElement {
    const isRtl = locale === 'ar' || locale === 'ku'
    const resolvedLogoUrl = resolveWorkspaceLogoSrc(logoUrl)
    const quantity = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value)
    const showQuantityColumn = lines.some((line) => !infiniteActivityIds.has(line.activityId))

    return (
        <article
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-white p-4 text-black"
            style={{ fontFamily: 'Inter, Arial, sans-serif', fontSize: '11px', lineHeight: 1.45 }}
        >
            <header className="border-b border-dashed border-slate-400 pb-3 text-center">
                {resolvedLogoUrl ? <img src={resolvedLogoUrl} alt="" className="mx-auto mb-2 h-14 w-14 object-contain" /> : null}
                <h1 className="m-0 text-base font-bold">{workspaceName}</h1>
                <p className="m-0 font-semibold text-black">{labels.activityReceipt}</p>
                <p className="m-0 font-semibold text-black">{transaction.transactionNo}</p>
            </header>

            <section className="space-y-1 border-b border-dashed border-slate-300 py-3">
                <p className="m-0 font-semibold">{transaction.name}</p>
                {transaction.customerName ? <p className="m-0 font-medium text-black">{labels.customer}: {transaction.customerName}</p> : null}
                <p className="m-0 font-medium text-black">{new Date(transaction.occurredAt).toLocaleString(locale)}</p>
                <p className="m-0 font-medium text-black">{labels.status}: {labels.statusValue} · {labels.paymentMethod}</p>
            </section>

            <table className="w-full border-collapse text-[10px]">
                <thead>
                    <tr className="border-b border-slate-300 text-black">
                        <th className="py-2 text-start font-semibold">{labels.activity}</th>
                        {showQuantityColumn ? <th className="py-2 text-end font-semibold">{labels.quantity}</th> : null}
                        <th className="py-2 text-end font-semibold">{labels.unitPrice}</th>
                        <th className="py-2 text-end font-semibold">{labels.total}</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line) => (
                        <tr key={line.id} className="border-b border-slate-200">
                            <td className="py-2 pe-1"><strong>{line.activityNameSnapshot}</strong>{line.priceOverridden ? <div className="mt-0.5 text-[9px] text-amber-700">{labels.priceOverridden}</div> : null}</td>
                            {showQuantityColumn ? <td className="py-2 text-end font-medium">{infiniteActivityIds.has(line.activityId) ? null : quantity(line.quantity)}</td> : null}
                            <td className="py-2 text-end font-medium">{formatCurrency(line.unitPrice, transaction.currency, iqdDisplayPreference)}</td>
                            <td className="py-2 text-end font-semibold">{formatCurrency(line.lineTotal, transaction.currency, iqdDisplayPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <footer className="mt-3 border-t border-dashed border-slate-400 pt-3">
                <div className="flex items-center justify-between text-sm font-bold"><span>{labels.total}</span><span>{formatCurrency(transaction.totalAmount, transaction.currency, iqdDisplayPreference)}</span></div>
                <p className="mb-0 mt-4 text-center text-[10px] font-medium text-black">{labels.madeby}</p>
            </footer>
        </article>
    )
}
