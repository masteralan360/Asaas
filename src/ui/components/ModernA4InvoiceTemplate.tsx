import { forwardRef } from 'react'
import { UniversalInvoice } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import { useTranslation } from 'react-i18next'
import { ReactQRCode } from '@lglab/react-qr-code'

interface ModernA4InvoiceTemplateProps {
    data: UniversalInvoice
    features: any
    workspaceId?: string
    workspaceName?: string
}

export const ModernA4InvoiceTemplate = forwardRef<HTMLDivElement, ModernA4InvoiceTemplateProps>(
    ({ data, features, workspaceId: propWorkspaceId, workspaceName }, ref) => {
        const { i18n } = useTranslation()
        const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
        const t = i18n.getFixedT(printLang)
        const isRTL = printLang === 'ar' || printLang === 'ku'
        const items = data.items || []
        const effectiveWorkspaceId = propWorkspaceId || data.workspaceId

        // Extract Multi-Currency Data for Footer
        const settlementCurrency = (data.settlement_currency || 'usd').toLowerCase()
        const iqdDisplayPreference = features?.iqd_display_preference
        const totalAmountRaw = Number(data.total_amount)
        const totalAmount = Number.isFinite(totalAmountRaw) ? totalAmountRaw : 0
        const subtotalAmountRaw = data.subtotal_amount == null ? totalAmount : Number(data.subtotal_amount)
        const subtotalAmount = Number.isFinite(subtotalAmountRaw) ? subtotalAmountRaw : totalAmount
        const uniqueOriginalCurrencies = Array.from(new Set(items.map(i => (i.original_currency || 'usd').toLowerCase())))
            .filter(c => c !== settlementCurrency)
        const currencyTotals: Record<string, number> = {}
        uniqueOriginalCurrencies.forEach(curr => {
            currencyTotals[curr] = items
                .filter(i => (i.original_currency || 'usd').toLowerCase() === curr)
                .reduce((sum, i) => {
                    const originalUnitPriceRaw = Number(i.original_unit_price)
                    const originalUnitPrice = Number.isFinite(originalUnitPriceRaw) ? originalUnitPriceRaw : 0
                    const quantityRaw = Number(i.quantity)
                    const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0
                    return sum + (originalUnitPrice * quantity)
                }, 0)
        })

        const tr = (key: string, fallback: string) => {
            const translated = t(key)
            return translated && translated !== key ? translated : fallback
        }

        const trimTrailingColon = (label: string) => label.replace(/\s*:+\s*$/u, '')
        const shippedToLabel = `${trimTrailingColon(tr('invoice.shippedTo', 'Shipped To'))}:`
        const viaLabel = `${trimTrailingColon(tr('invoice.via', 'Via'))}:`

        const createdAt = new Date(data.created_at)
        const hasValidCreatedAt = !Number.isNaN(createdAt.getTime())
        const dateLabel = hasValidCreatedAt
            ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(createdAt)
            : '--/--/----'
        const timeLabel = hasValidCreatedAt
            ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(createdAt)
            : '--:--'

        // Brand Color from reference
        const BRAND_COLOR = '#197fe6'

        return (
            <div
                ref={ref}
                dir={isRTL ? 'rtl' : 'ltr'}
                className="a4-container relative p-[15mm] md:p-[20mm] bg-white text-slate-900 antialiased overflow-hidden flex flex-col"
                style={{ width: '210mm', height: '297mm', margin: '0 auto' }}
            >
                {/* Internal Styles for Print Exactness */}
                <style dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { size: A4; margin: 0; }
    body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; display: block; padding: 0; margin: 0; }
    .no-print { display: none; }
    .a4-container { margin: 0; box-shadow: none; width: 100%; height: 100%; page-break-after: avoid; }
}
.text-primary { color: ${BRAND_COLOR}; }
.bg-primary { background-color: ${BRAND_COLOR}; }
.border-primary { border-color: ${BRAND_COLOR}; }
`}} />

                {/* HEADER */}
                <header className="flex justify-between items-start border-b border-slate-200 pb-4 mb-4 shrink-0">
                    <div className="w-20 h-20 flex-shrink-0">
                        {features.logo_url ? (
                            <div className="w-full h-full rounded-xl flex items-center justify-center border border-slate-200 overflow-hidden bg-white">
                                <img
                                    src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)}
                                    alt="Workspace Logo"
                                    className="max-h-full max-w-full object-contain"
                                />
                            </div>
                        ) : (
                            <div className="w-full h-full bg-slate-100 rounded-xl flex flex-col items-center justify-center border border-slate-200 text-slate-400 overflow-hidden">
                                <span className="text-[10px] font-bold uppercase tracking-wider">Logo Here</span>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 text-center px-4 pt-1">
                        <h1 className="text-2xl font-extrabold text-primary tracking-tight mb-1">{workspaceName || 'Asaas'}</h1>
                        <p className="text-slate-500 text-[10px] font-medium">Providing Quality Solutions Since 1995</p>
                        <div className="mt-1 text-[9px] text-slate-400 flex flex-col gap-0.5">
                            {/* In a real app, these would come from workspace settings */}
                            <span>Digital solutions for modern businesses</span>
                        </div>
                    </div>
                    <div className="w-16 flex flex-col items-end gap-1 flex-shrink-0">
                        {features.print_qr && effectiveWorkspaceId && (data.sequenceId || data.invoiceid) && (
                            <div className="bg-white p-1 border border-slate-200 rounded-lg w-16 h-16 flex items-center justify-center overflow-hidden" data-qr-sharp="true">
                                <ReactQRCode
                                    value={`https://asaas-r2-proxy.alanepic360.workers.dev/${effectiveWorkspaceId}/printed-invoices/A4/${data.id}.pdf`}
                                    size={58}
                                    level="M"
                                />
                            </div>
                        )}
                        <span className="text-[8px] text-slate-400 font-mono text-right">{tr('common.scanToVerify', 'Scan to Verify')}</span>
                    </div>
                </header>

                {/* INFO GRID */}
                <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
                    <div className="flex flex-col items-center text-center gap-0.5 p-2 rounded-lg bg-slate-50 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-700">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">{tr('invoice.date', 'Date')}</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{dateLabel}</span>
                    </div>
                    <div className="flex flex-col items-center text-center gap-0.5 p-2 rounded-lg bg-slate-50 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-700">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">{tr('common.time', 'Time')}</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{timeLabel}</span>
                    </div>
                    <div className="flex flex-col items-center text-center gap-0.5 p-2 rounded-lg bg-slate-50 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-700">
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">{tr('invoice.number', 'Invoice #')}</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{data.invoiceid || `#${String(data.id).slice(0, 8)}`}</span>
                    </div>
                </div>

                {/* PARTIES */}
                <div className="grid grid-cols-2 gap-8 mb-4 shrink-0">
                    <div className="flex flex-col gap-2">
                        <div>
                            <h3 className="text-primary text-[10px] font-bold uppercase tracking-wide border-b border-primary/20 pb-1 mb-1">
                                {tr('invoice.soldTo', 'Sold To:')}
                            </h3>
                            <div className="flex flex-col gap-1 mt-1">
                                <span className="font-bold text-slate-800 text-xs">{data.customer_name || ''}</span>
                                <div className="border-b border-slate-200 dark:border-slate-600 w-full h-4"></div>
                                <div className="border-b border-slate-200 dark:border-slate-600 w-full h-4"></div>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div>
                            <h3 className="text-primary text-[10px] font-bold uppercase tracking-wide border-b border-primary/20 pb-1 mb-0.5">
                                {tr('invoice.soldBy', 'Sold By:')}
                            </h3>
                            <div className="flex flex-col gap-1 mt-0">
                                <span className="font-bold text-slate-800 text-xs">{data.cashier_name || ''}</span>
                                <div className="text-[9px] text-slate-500">{shippedToLabel} ___________________________________________________________________________</div>
                                <div className="text-[9px] text-slate-500">{viaLabel} ___________________________________________________________________________</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ITEMS TABLE */}
                <div className="flex-grow mb-4 flex flex-col min-h-0">
                    <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700 flex-grow">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-[9px] uppercase tracking-wider font-semibold border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700 h-8">
                                    <th className="px-2 w-1/3 border-r border-slate-200 dark:border-slate-700">{tr('invoice.productName', 'Product Name')}</th>
                                    <th className="px-2 w-12 text-center border-r border-slate-200 dark:border-slate-700">{tr('invoice.qty', 'Qty')}</th>
                                    <th className="px-2 w-24 text-right border-r border-slate-200 dark:border-slate-700">{tr('invoice.price', 'Price')}</th>
                                    <th className="px-2 w-16 text-center border-r border-slate-200 dark:border-slate-700">{tr('invoice.discount', 'Discount')}</th>
                                    <th className="px-2 w-28 text-right">{tr('invoice.total', 'Total')}</th>
                                </tr>
                            </thead>
                            <tbody className="text-[10px]">
                                {items.map((item, idx) => {
                                    const quantityRaw = Number(item.quantity)
                                    const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0
                                    const unitPriceRaw = Number(item.unit_price)
                                    const unitPrice = Number.isFinite(unitPriceRaw) ? unitPriceRaw : 0
                                    const discountRaw = Number(item.discount_amount)
                                    const discountAmount = Number.isFinite(discountRaw) ? discountRaw : 0
                                    const itemTotalRaw = Number(item.total_price)
                                    const total = (item.total_price != null && Number.isFinite(itemTotalRaw))
                                        ? itemTotalRaw
                                        : unitPrice * quantity
                                    const priceToShow = unitPrice + (quantity > 0 ? (discountAmount / quantity) : 0)

                                    return (
                                        <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors dark:border-slate-700 h-7">
                                            <td className="px-2 font-semibold text-slate-800 dark:text-white border-r border-slate-100 dark:border-slate-700 truncate">
                                                {item.product_name}
                                            </td>
                                            <td className="px-2 text-center text-slate-500 border-r border-slate-100 dark:border-slate-700 font-bold">
                                                {quantity}
                                            </td>
                                            <td className="px-2 text-right font-medium text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-700 tabular-nums">
                                                {formatCurrency(priceToShow, settlementCurrency, iqdDisplayPreference)}
                                            </td>
                                            <td className="px-2 text-center text-green-600 font-medium border-r border-slate-100 dark:border-slate-700">
                                                {discountAmount > 0 ? formatCurrency(discountAmount, settlementCurrency, iqdDisplayPreference) : '-'}
                                            </td>
                                            <td className="px-2 text-right font-bold text-slate-900 dark:text-white tabular-nums">
                                                {formatCurrency(total, settlementCurrency, iqdDisplayPreference)}
                                            </td>
                                        </tr>
                                    )
                                })}
                                {/* Fill empty space to keep layout consistent if needed */}
                                {items.length < 15 && Array.from({ length: 15 - items.length }).map((_, i) => (
                                    <tr key={`empty-${i}`} className="border-b border-slate-50 last:border-0 h-7 opacity-20">
                                        <td className="px-2 border-r border-slate-50">&nbsp;</td>
                                        <td className="px-2 border-r border-slate-50">&nbsp;</td>
                                        <td className="px-2 border-r border-slate-50">&nbsp;</td>
                                        <td className="px-2 border-r border-slate-50">&nbsp;</td>
                                        <td className="px-2">&nbsp;</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="mt-auto pt-4 border-t border-slate-200 flex flex-row gap-6 shrink-0">
                    <div className="flex-1 pr-4 flex flex-col justify-between">
                        <div>
                            <h4 className="text-[10px] font-bold text-slate-800 mb-1 dark:text-white uppercase tracking-wider">{tr('invoice.terms', 'Terms & Conditions')}</h4>
                            <div className="flex flex-col gap-3 mt-1 w-full opacity-40">
                                <div className="border-b border-slate-200 dark:border-slate-600 w-full h-3"></div>
                                <div className="border-b border-slate-200 dark:border-slate-600 w-full h-3"></div>
                            </div>
                        </div>

                        {data.exchange_rates && data.exchange_rates.length > 0 && (
                            <div className="flex flex-col gap-2 mt-4">
                                <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">{tr('invoice.exchangeRates', 'Exchange Rates')}</div>
                                <div className="flex flex-wrap gap-2">
                                    {data.exchange_rates.slice(0, 3).map((rate: any, i: number) => (
                                        <div key={i} className="px-2 py-1 bg-slate-50 rounded text-[9px] font-mono font-medium text-slate-600 border border-slate-100 tabular-nums">
                                            {rate.pair}: {rate.rate}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-[280px]">
                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 dark:bg-slate-800/50">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] text-slate-500 font-medium uppercase">{tr('invoice.subtotal', 'Subtotal')}</span>
                                <span className="text-xs font-bold text-slate-700 tabular-nums">
                                    {formatCurrency(subtotalAmount, settlementCurrency, iqdDisplayPreference)}
                                </span>
                            </div>
                            {Object.entries(currencyTotals).map(([code, amount]) => (
                                <div key={code} className="flex justify-between items-center mb-2 pb-2 border-b border-slate-200 border-dashed">
                                    <span className="text-[10px] text-slate-300 font-bold lowercase italic">
                                        {tr('common.total', 'Total')} ({code}):
                                    </span>
                                    <span className="text-xs font-bold text-slate-500 tabular-nums">
                                        {formatCurrency(amount, code, iqdDisplayPreference)}
                                    </span>
                                </div>
                            ))}
                            <div className="flex justify-between items-end">
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider font-black text-primary italic leading-tight">{tr('invoice.total', 'Total')}</span>
                                    <span className="text-[8px] text-slate-400 uppercase font-medium">({settlementCurrency.toUpperCase()})</span>
                                </div>
                                <span className="text-xl font-black text-primary leading-none tracking-tighter tabular-nums">
                                    {formatCurrency(totalAmount, settlementCurrency, iqdDisplayPreference)}
                                </span>
                            </div>
                        </div>

                        <div className="mt-4 text-center text-[8px] text-slate-400 uppercase tracking-widest font-bold">
                            {data.origin === 'pos' ? tr('invoice.posSystem', 'POS System') : 'Asaas'} | {tr('invoice.generated', 'Generated Automatically')}
                        </div>
                    </div>
                </div>

                {/* BOTTOM ACCENT */}
                <div className="absolute bottom-0 left-0 w-full h-1.5 bg-primary"></div>
            </div>
        )
    }
)

ModernA4InvoiceTemplate.displayName = 'ModernA4InvoiceTemplate'
