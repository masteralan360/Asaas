import { forwardRef } from 'react'
import { Sale } from '@/types'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'

interface A4InvoiceTemplateProps {
    sale: Sale
    features: any
}

export const A4InvoiceTemplate = forwardRef<HTMLDivElement, A4InvoiceTemplateProps>(
    ({ sale, features }, ref) => {
        const items = sale.items || []

        // Extract Multi-Currency Data for Footer
        const settlementCurrency = sale.settlement_currency || 'usd'
        const uniqueOriginalCurrencies = Array.from(new Set(items.map(i => i.original_currency || 'usd')))
            .filter(c => c !== settlementCurrency)

        const currencyTotals: Record<string, number> = {}
        uniqueOriginalCurrencies.forEach(curr => {
            currencyTotals[curr] = items
                .filter(i => (i.original_currency || 'usd') === curr)
                .reduce((sum, i) => sum + ((i.original_unit_price || 0) * (i.quantity || 0)), 0)
        })

        // Brand Color from Template
        const BRAND_COLOR = '#5c6ac4'

        return (
            <div ref={ref} className="bg-white text-black text-sm font-sans relative flex flex-col min-h-[297mm]" style={{ width: '210mm', padding: '0', margin: '0 auto' }}>
                {/* Internal Styles for Print Exactness */}
                <style dangerouslySetInnerHTML={{
                    __html: `
                    @media print {
                        @page { margin: 0; size: A4; }
                        body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
                    }
                    .text-main { color: ${BRAND_COLOR}; }
                    .bg-main { background-color: ${BRAND_COLOR}; }
                    .border-main { border-color: ${BRAND_COLOR}; }
                `}} />

                {/* TOP HEADER SECTION */}
                <div className="px-14 py-6">
                    <table className="w-full border-collapse">
                        <tbody>
                            <tr>
                                <td className="w-1/2 align-top">
                                    <div className="h-16 flex items-center justify-start w-48">
                                        {features.logo_url ? (
                                            <img
                                                src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)}
                                                alt="Workspace Logo"
                                                className="max-h-16 max-w-full object-contain"
                                            />
                                        ) : (
                                            <div className="h-12 flex items-center bg-gray-100 border border-gray-200 justify-center w-48 text-gray-400 font-bold tracking-wider uppercase">
                                                LOGO
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="w-1/2 align-top text-right">
                                    <div className="text-sm inline-block text-left">
                                        <table className="border-collapse">
                                            <tbody>
                                                <tr>
                                                    <td className="border-r pr-4 text-right">
                                                        <p className="whitespace-nowrap text-slate-400 text-xs uppercase font-semibold">Date</p>
                                                        <p className="whitespace-nowrap font-bold text-main">{formatDateTime(sale.created_at)}</p>
                                                    </td>
                                                    <td className="pl-4 text-right">
                                                        <p className="whitespace-nowrap text-slate-400 text-xs uppercase font-semibold">Invoice #</p>
                                                        <p className="whitespace-nowrap font-bold text-main text-lg">
                                                            #{String(sale.sequence_id || 0).padStart(5, '0')}
                                                        </p>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* ADDRESS / INFO SECTION */}
                <div className="bg-slate-100 px-14 py-6 text-sm">
                    <table className="w-full border-collapse">
                        <tbody>
                            <tr>
                                <td className="w-1/2 align-top text-neutral-600">
                                    <p className="font-bold text-black mb-1">Sold To:</p>
                                    <div className="h-6 w-full border-b border-gray-300 mb-1"></div>
                                    <div className="h-6 w-full border-b border-gray-300 mb-1"></div>
                                    <div className="h-6 w-1/2 border-b border-gray-300"></div>
                                </td>
                                <td className="w-1/2 align-top text-right text-neutral-600">
                                    <p className="font-bold text-black mb-1">Sold By: </p>
                                    <p className="font-mono font-bold text-main text-lg">{sale.cashier_name?.slice(0, 8) || 'STAFF'}</p>
                                    <p className="text-xs mt-1">Shipped To: ________________</p>
                                    <p className="text-xs">Via: ______________________</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* MAIN PRODUCTS TABLE - Grows dynamically */}
                <div className="px-14 py-8 flex-grow">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr>
                                <th className="border-b-2 border-main pb-3 pl-2 text-center font-bold text-main w-[60px]">Qty</th>
                                <th className="border-b-2 border-main pb-3 pl-2 text-left font-bold text-main">Product Name</th>
                                <th className="border-b-2 border-main pb-3 pl-2 text-left font-bold text-main">Description</th>
                                <th className="border-b-2 border-main pb-3 pl-2 text-right font-bold text-main w-[100px]">Price</th>
                                <th className="border-b-2 border-main pb-3 pl-2 text-center font-bold text-main w-[80px]">Discount</th>
                                <th className="border-b-2 border-main pb-3 pl-2 pr-3 text-right font-bold text-main w-[110px]">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => {
                                const finalUnitPrice = item.converted_unit_price || item.unit_price || 0
                                const hasNegotiation = item.negotiated_price !== undefined && item.negotiated_price !== null && item.negotiated_price !== item.original_unit_price

                                // Calculate Original and Discount in settlement currency
                                // We use the ratio from the original product currency prices to derive the converted original price
                                const discountRatio = hasNegotiation ? (item.negotiated_price! / item.original_unit_price) : 1
                                const priceToShow = hasNegotiation ? (finalUnitPrice / discountRatio) : finalUnitPrice
                                const discountAmount = priceToShow - finalUnitPrice

                                const total = finalUnitPrice * item.quantity

                                return (
                                    <tr key={idx} className="text-neutral-700">
                                        <td className="border-b py-2 pl-2 text-center font-bold">{item.quantity}</td>
                                        <td className="border-b py-2 pl-2 font-bold">{item.product_name}</td>
                                        <td className="border-b py-2 pl-2 text-sm text-neutral-500 truncate max-w-[200px]">{item.product_sku || '-'}</td>
                                        <td className="border-b py-2 pl-2 text-right">
                                            {formatCurrency(priceToShow, settlementCurrency, features.iqd_display_preference)}
                                        </td>
                                        <td className="border-b py-2 pl-2 text-center text-neutral-400">
                                            {discountAmount > 0 ? formatCurrency(discountAmount, settlementCurrency, features.iqd_display_preference) : '-'}
                                        </td>
                                        <td className="border-b py-2 pl-2 pr-3 text-right font-bold text-black">
                                            {formatCurrency(total, settlementCurrency, features.iqd_display_preference)}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* FOOTER - Pushed to bottom or flows after content */}
                <div className="px-14 pb-12 mt-auto">
                    <div className="flex gap-8 items-start page-break-inside-avoid">
                        {/* Left: Notes & Terms */}
                        <div className="flex-1 text-sm text-neutral-700 space-y-4">
                            <div>
                                <p className="text-main font-bold uppercase text-xs mb-1">Terms & Conditions</p>
                                <div className="border border-dashed border-gray-300 h-20 rounded bg-gray-50 flex items-center justify-center text-gray-400 text-xs italic">
                                    (Terms text area)
                                </div>
                            </div>

                            {sale.exchange_rates && sale.exchange_rates.length > 0 && (
                                <div>
                                    <p className="text-main font-bold uppercase text-xs mb-1">Exchange Rates</p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {sale.exchange_rates.slice(0, 4).map((rate: any, i: number) => (
                                            <div key={i} className="flex justify-between bg-gray-50 px-2 py-1 rounded">
                                                <span>{rate.pair}</span>
                                                <span className="font-mono font-bold">{rate.rate}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: Totals Table */}
                        <div className="w-[350px]">
                            <table className="w-full border-collapse border-spacing-0">
                                <tbody>
                                    <tr>
                                        <td className="border-b p-3">
                                            <div className="whitespace-nowrap text-slate-400 text-sm">Subtotal:</div>
                                        </td>
                                        <td className="border-b p-3 text-right">
                                            <div className="whitespace-nowrap font-bold text-main text-lg">
                                                {formatCurrency(sale.total_amount, settlementCurrency, features.iqd_display_preference)}
                                            </div>
                                        </td>
                                    </tr>

                                    {Object.entries(currencyTotals).map(([code, amount], idx) => (
                                        <tr key={idx}>
                                            <td className="p-2 border-b border-dashed border-gray-200">
                                                <div className="whitespace-nowrap text-slate-400 text-xs text-left">Total ({code}):</div>
                                            </td>
                                            <td className="p-2 border-b border-dashed border-gray-200 text-right">
                                                <div className="whitespace-nowrap font-medium text-gray-600 text-xs">
                                                    {formatCurrency(amount, code, features.iqd_display_preference)}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    <tr>
                                        <td className="bg-main p-3">
                                            <div className="whitespace-nowrap font-bold text-white text-lg">Total:</div>
                                        </td>
                                        <td className="bg-main p-3 text-right">
                                            <div className="whitespace-nowrap font-bold text-white text-xl">
                                                {formatCurrency(sale.total_amount, settlementCurrency, features.iqd_display_preference)}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Site Footer */}
                    <div className="mt-8 border-t border-gray-200 pt-3 text-center text-xs text-neutral-500">
                        Asaas
                        <span className="text-slate-300 px-2">|</span>
                        Generated Automatically
                    </div>
                </div>
            </div>
        )
    }
)

A4InvoiceTemplate.displayName = 'A4InvoiceTemplate'
