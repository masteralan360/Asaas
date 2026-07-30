import { useTranslation } from 'react-i18next'

import type { IQDDisplayPreference, PurchaseOrder, SalesOrder } from '@/local-db'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { CustomTemplateComponentPosition } from '@/lib/pdfPreviewStore'
import { platformService } from '@/services/platformService'
import { MovableOrderPrintBlock } from '@/ui/components/MovableComponentPrint'

export type PartnerOrderItemsPrintPeriod = {
    type: 'today' | 'month' | 'lastMonth' | 'allTime' | 'custom'
    start?: string
    end?: string
}

export type PartnerOrderItemsPrintRowKind =
    | 'item'
    | 'discount'
    | 'tax'
    | 'adjustment'
    | 'order_note'
    | 'order_total'

export type PartnerOrderItemsPrintRow = {
    id: string
    orderId: string
    orderCode: string
    orderDate: string
    kind: PartnerOrderItemsPrintRowKind
    description: string
    note?: string | null
    unit?: string | null
    quantity?: number | null
    unitPrice?: number | null
    amount?: number | null
    currency: string
    adjustmentType?: 'addition' | 'deduction'
}

export type PartnerOrderItemsPrintCurrencySummary = {
    currency: string
    orderCount: number
    itemSubtotal: number
    discount: number
    tax: number
    additions: number
    deductions: number
    total: number
    paidAmount: number
    remainingAmount: number
}

export type PartnerOrderItemsPrintSection = {
    rows: PartnerOrderItemsPrintRow[]
    summaries: PartnerOrderItemsPrintCurrencySummary[]
}

export type PartnerOrderItemsPrintData = {
    workspace?: {
        phone?: string
        address?: string
        email?: string
    }
    partner: {
        name: string
        contactName?: string
        email?: string
        phone?: string
        address?: string
        city?: string
        country?: string
    }
    period: PartnerOrderItemsPrintPeriod
    generatedAt: string
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
}

interface PartnerOrderItemsPrintTemplateProps {
    workspaceName?: string | null
    workspaceDescription?: string | null
    printLang: string
    data: PartnerOrderItemsPrintData
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
    componentPositions?: Record<string, CustomTemplateComponentPosition>
    editableComponents?: boolean
    onComponentPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
}

type StatementOrder = SalesOrder | PurchaseOrder
type StatementKind = 'sales' | 'purchase'

export const PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS = {
    workspaceName: 'partnerOrderItemsWorkspaceName'
} as const

function isRTL(lang: string) {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function resolvePeriodLabel(
    period: PartnerOrderItemsPrintPeriod,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (period.start || period.end) {
        return t('businessPartners.fromDateToDate', {
            defaultValue: 'from {{start}} to {{end}}',
            start: period.start ? formatDate(period.start) : '-',
            end: period.end ? formatDate(period.end) : '-'
        })
    }

    return t('businessPartners.orderItemsPrint.allTime', { defaultValue: 'All Time' })
}

function isSalesOrder(_order: StatementOrder, kind: StatementKind): _order is SalesOrder {
    return kind === 'sales'
}

function createSummary(currency: string): PartnerOrderItemsPrintCurrencySummary {
    return {
        currency,
        orderCount: 0,
        itemSubtotal: 0,
        discount: 0,
        tax: 0,
        additions: 0,
        deductions: 0,
        total: 0,
        paidAmount: 0,
        remainingAmount: 0
    }
}

/**
 * Produces a flat, auditable statement: every line retains its source order
 * code while commercial terms remain separate rows instead of being invented
 * as allocations across products.
 */
export function buildPartnerOrderItemsPrintSection(
    orders: StatementOrder[],
    kind: StatementKind
): PartnerOrderItemsPrintSection {
    const summaries = new Map<string, PartnerOrderItemsPrintCurrencySummary>()
    const rows: PartnerOrderItemsPrintRow[] = []
    const sortedOrders = orders
        .filter((order) => !order.isDeleted && order.status !== 'cancelled')
        .slice()
        .sort((left, right) => {
            const dateDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
            return dateDifference || left.orderNumber.localeCompare(right.orderNumber)
        })

    for (const order of sortedOrders) {
        const summary = summaries.get(order.currency) || createSummary(order.currency)
        summaries.set(order.currency, summary)
        summary.orderCount += 1
        summary.itemSubtotal += order.subtotal
        summary.discount += order.discount
        summary.total += order.total
        summary.paidAmount += order.paidAmount
        summary.remainingAmount += order.balanceAmount

        if (isSalesOrder(order, kind)) {
            summary.tax += order.tax
        }

        for (const item of order.items) {
            rows.push({
                id: `${order.id}:item:${item.id}`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'item',
                description: item.productName,
                note: item.note,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.convertedUnitPrice,
                amount: item.lineTotal,
                currency: order.currency
            })
        }

        if (order.discount > 0) {
            rows.push({
                id: `${order.id}:discount`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'discount',
                description: 'discount',
                amount: -order.discount,
                currency: order.currency
            })
        }

        if (isSalesOrder(order, kind) && order.tax > 0) {
            rows.push({
                id: `${order.id}:tax`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'tax',
                description: 'tax',
                amount: order.tax,
                currency: order.currency
            })
        }

        for (const adjustment of order.orderAdjustments || []) {
            const amount = adjustment.type === 'deduction'
                ? -adjustment.convertedAmount
                : adjustment.convertedAmount
            if (!Number.isFinite(amount) || amount === 0) continue

            if (adjustment.type === 'addition') summary.additions += adjustment.convertedAmount
            else summary.deductions += adjustment.convertedAmount

            rows.push({
                id: `${order.id}:adjustment:${adjustment.id}`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'adjustment',
                description: adjustment.name,
                amount,
                currency: order.currency,
                adjustmentType: adjustment.type
            })
        }

        if (order.notes?.trim()) {
            rows.push({
                id: `${order.id}:note`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'order_note',
                description: 'order_note',
                note: order.notes.trim(),
                currency: order.currency
            })
        }

        rows.push({
            id: `${order.id}:total`,
            orderId: order.id,
            orderCode: order.orderNumber,
            orderDate: order.createdAt,
            kind: 'order_total',
            description: 'order_total',
            amount: order.total,
            currency: order.currency
        })
    }

    return {
        rows,
        summaries: Array.from(summaries.values()).sort((left, right) => left.currency.localeCompare(right.currency))
    }
}

function statementRowLabel(
    row: PartnerOrderItemsPrintRow,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (row.kind === 'discount') return t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })
    if (row.kind === 'tax') return t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })
    if (row.kind === 'order_note') return t('businessPartners.orderItemsPrint.orderNote', { defaultValue: 'Order note' })
    if (row.kind === 'order_total') return t('businessPartners.orderItemsPrint.orderTotal', { defaultValue: 'Order total' })
    return row.description
}

function statementRowNote(
    row: PartnerOrderItemsPrintRow,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (row.kind !== 'adjustment') return row.note?.trim() || '—'
    return row.adjustmentType === 'deduction'
        ? t('businessPartners.orderItemsPrint.deduction', { defaultValue: 'Deduction' })
        : t('businessPartners.orderItemsPrint.addition', { defaultValue: 'Addition' })
}

function formatQuantity(quantity?: number | null) {
    if (quantity == null) return '—'
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantity)
}

function StatementSummary({
    summaries,
    kind,
    t,
    iqdPreference
}: {
    summaries: PartnerOrderItemsPrintCurrencySummary[]
    kind: StatementKind
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    if (summaries.length === 0) return null

    return (
        <div className="mt-2 space-y-2" data-pdf-keep-together>
            {summaries.map((summary) => (
                <div key={summary.currency} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px] sm:grid-cols-4">
                    <span>{t('businessPartners.orderItemsPrint.currency', { defaultValue: 'Currency' })}: <strong>{summary.currency.toUpperCase()}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.orders', { defaultValue: 'Orders' })}: <strong>{summary.orderCount}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.itemsSubtotal', { defaultValue: 'Items subtotal' })}: <strong>{formatCurrency(summary.itemSubtotal, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })}: <strong>-{formatCurrency(summary.discount, summary.currency, iqdPreference)}</strong></span>
                    {kind === 'sales' ? <span>{t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })}: <strong>+{formatCurrency(summary.tax, summary.currency, iqdPreference)}</strong></span> : null}
                    <span>{t('businessPartners.orderItemsPrint.additions', { defaultValue: 'Additions' })}: <strong>+{formatCurrency(summary.additions, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.deductions', { defaultValue: 'Deductions' })}: <strong>-{formatCurrency(summary.deductions, summary.currency, iqdPreference)}</strong></span>
                    <span className="font-bold">{t('businessPartners.orderItemsPrint.total', { defaultValue: 'Total' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: <strong>{formatCurrency(summary.paidAmount, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: <strong>{formatCurrency(summary.remainingAmount, summary.currency, iqdPreference)}</strong></span>
                </div>
            ))}
        </div>
    )
}

function OrderItemsSection({
    title,
    emptyLabel,
    section,
    kind,
    t,
    iqdPreference
}: {
    title: string
    emptyLabel: string
    section: PartnerOrderItemsPrintSection
    kind: StatementKind
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    return (
        <section className="mt-5" data-pdf-keep-together>
            <div className="mb-2 flex items-center justify-between border-b-2 border-slate-700 pb-1">
                <h2 className="text-sm font-bold">{title}</h2>
                <span className="text-[9px]">{section.summaries.reduce((total, summary) => total + summary.orderCount, 0)} {t('businessPartners.orderItemsPrint.orders', { defaultValue: 'Orders' })}</span>
            </div>
            <table className="w-full border-collapse text-[8px]">
                <thead>
                    <tr className="bg-[#dfead3]">
                        <th className="w-[4%] border border-slate-400 p-1 text-center">#</th>
                        <th className="w-[11%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.orderCode', { defaultValue: 'Order code' })}</th>
                        <th className="w-[21%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.productRow', { defaultValue: 'Product / row' })}</th>
                        <th className="w-[22%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.note', { defaultValue: 'Note' })}</th>
                        <th className="w-[8%] border border-slate-400 p-1 text-center">{t('businessPartners.orderItemsPrint.unit', { defaultValue: 'Unit' })}</th>
                        <th className="w-[8%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.quantity', { defaultValue: 'Qty' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.unitPrice', { defaultValue: 'Price' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {section.rows.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="border border-slate-400 p-4 text-center">{emptyLabel}</td>
                        </tr>
                    ) : section.rows.map((row, index) => (
                        <tr
                            key={row.id}
                            className={row.kind === 'order_total'
                                ? 'bg-slate-200 font-bold'
                                : row.kind === 'item'
                                    ? ''
                                    : 'bg-slate-50'}
                            data-pdf-keep-together
                        >
                            <td className="border border-slate-300 p-1 text-center">{index + 1}</td>
                            <td className="border border-slate-300 p-1 align-top font-semibold">
                                <div>{row.orderCode}</div>
                                <div className="mt-0.5 text-[7px] font-normal">{formatDate(row.orderDate)}</div>
                            </td>
                            <td className="border border-slate-300 p-1 align-top">{statementRowLabel(row, t)}</td>
                            <td className="border border-slate-300 p-1 align-top whitespace-pre-wrap">{statementRowNote(row, t)}</td>
                            <td className="border border-slate-300 p-1 text-center">{row.unit?.trim() || '—'}</td>
                            <td className="border border-slate-300 p-1 text-end">{formatQuantity(row.quantity)}</td>
                            <td className="border border-slate-300 p-1 text-end">{row.unitPrice == null ? '—' : formatCurrency(row.unitPrice, row.currency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-1 text-end font-semibold">{row.amount == null ? '—' : formatCurrency(row.amount, row.currency, iqdPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <StatementSummary summaries={section.summaries} kind={kind} t={t} iqdPreference={iqdPreference} />
        </section>
    )
}

export function PartnerOrderItemsPrintTemplate({
    workspaceName,
    workspaceDescription,
    printLang,
    data,
    iqdPreference = 'IQD',
    logoUrl,
    componentPositions,
    editableComponents,
    onComponentPositionChange
}: PartnerOrderItemsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const isRtl = isRTL(printLang)
    const logoSrc = resolveLogoSrc(logoUrl)
    const periodLabel = resolvePeriodLabel(data.period, t)
    const partnerLocation = [data.partner.address, data.partner.city, data.partner.country].filter(Boolean).join(', ')
    const salesSection = buildPartnerOrderItemsPrintSection(data.salesOrders, 'sales')
    const purchaseSection = buildPartnerOrderItemsPrintSection(data.purchaseOrders, 'purchase')

    return (
        <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm' }}
            data-partner-order-items-print
            data-order-print-page
            data-page-width-mm="210"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-partner-order-items-print] tr,
    [data-partner-order-items-print] [data-pdf-keep-together] {
        break-inside: avoid;
        page-break-inside: avoid;
    }
    [data-partner-order-items-print] thead { display: table-header-group; }
}
`
                }}
            />
            <section className="bg-white" style={{ minHeight: '297mm', padding: '10mm 9mm', boxSizing: 'border-box' }}>
                <header className="grid grid-cols-3 border border-slate-500 text-[9px]" data-pdf-keep-together>
                    <div className="min-h-[32mm] border-e border-slate-500 p-2 leading-relaxed">
                        <MovableOrderPrintBlock
                            componentKey={PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS.workspaceName}
                            label={t('workspaceConfig.workspaceName', { defaultValue: 'Workspace Name' })}
                            position={componentPositions?.[PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS.workspaceName]}
                            editable={editableComponents}
                            onPositionChange={onComponentPositionChange}
                            wrapperClassName="inline-block max-w-full"
                            resizable
                        >
                            <div className="font-bold text-[11px]">{workspaceName || t('businessPartners.ourBusiness', { defaultValue: 'Our business' })}</div>
                        </MovableOrderPrintBlock>
                        {workspaceDescription?.trim() ? <div className="mt-1 whitespace-pre-wrap">{workspaceDescription.trim()}</div> : null}
                        {data.workspace?.phone?.trim() ? <div>{data.workspace.phone}</div> : null}
                        {data.workspace?.email?.trim() ? <div>{data.workspace.email}</div> : null}
                        {data.workspace?.address?.trim() ? <div>{data.workspace.address}</div> : null}
                    </div>
                    <div className="flex min-h-[32mm] items-center justify-center border-e border-slate-500 p-2">
                        {logoSrc ? (
                            <img src={logoSrc} alt="" className="max-h-[28mm] max-w-[48mm] object-contain" />
                        ) : (
                            <div className="text-center text-xs font-bold">{workspaceName || 'Atlas'}</div>
                        )}
                    </div>
                    <div className="min-h-[32mm] p-2 text-end leading-relaxed">
                        <div className="font-bold text-[11px]">{t('businessPartners.orderItemsPrint.title', { defaultValue: 'Partner Order Items Statement' })}</div>
                        <div className="mt-1"><span>{t('businessPartners.orderItemsPrint.partner', { defaultValue: 'Partner' })}: </span><strong>{data.partner.name}</strong></div>
                        {data.partner.contactName?.trim() ? <div>{data.partner.contactName}</div> : null}
                        {data.partner.phone?.trim() ? <div>{data.partner.phone}</div> : null}
                    </div>
                </header>

                <div className="mt-2 grid grid-cols-3 gap-2 border-b border-slate-300 pb-2 text-[9px]" data-pdf-keep-together>
                    <div><span>{t('businessPartners.orderItemsPrint.period', { defaultValue: 'Period' })}: </span><strong>{periodLabel}</strong></div>
                    <div><span>{t('businessPartners.orderItemsPrint.address', { defaultValue: 'Address' })}: </span>{partnerLocation || '—'}</div>
                    <div className="text-end"><span>{t('businessPartners.orderItemsPrint.printed', { defaultValue: 'Printed' })}: </span>{formatDateTime(data.generatedAt)}</div>
                </div>

                <OrderItemsSection
                    title={t('businessPartners.orderItemsPrint.salesOrders', { defaultValue: 'Sales Orders' })}
                    emptyLabel={t('businessPartners.orderItemsPrint.noSalesOrderItemsInPeriod', { defaultValue: 'No sales order items in the selected period.' })}
                    section={salesSection}
                    kind="sales"
                    t={t}
                    iqdPreference={iqdPreference}
                />
                <OrderItemsSection
                    title={t('businessPartners.orderItemsPrint.purchaseOrders', { defaultValue: 'Purchase Orders' })}
                    emptyLabel={t('businessPartners.orderItemsPrint.noPurchaseOrderItemsInPeriod', { defaultValue: 'No purchase order items in the selected period.' })}
                    section={purchaseSection}
                    kind="purchase"
                    t={t}
                    iqdPreference={iqdPreference}
                />
            </section>
        </div>
    )
}
