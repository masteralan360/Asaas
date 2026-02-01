
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { UniversalInvoice } from '@/types'
import { formatCurrency, formatDateTime, formatSnapshotTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import { useWorkspace } from '@/workspace'

interface SaleReceiptProps {
    data: UniversalInvoice
    features: any
}

export const SaleReceipt = forwardRef<HTMLDivElement, SaleReceiptProps>(
    ({ data, features }, ref) => {
        const { t } = useTranslation()
        const { workspaceName } = useWorkspace()

        const formatReceiptPrice = (amount: number, currency: string) => {
            const code = currency.toLowerCase()
            let formattedNum = ''
            let currencyLabel = code.toUpperCase()

            if (code === 'iqd') {
                formattedNum = new Intl.NumberFormat('en-US').format(amount)
                currencyLabel = features.iqd_display_preference === 'IQD' ? 'IQD' : 'د.ع'
            } else if (code === 'eur') {
                formattedNum = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
            } else {
                formattedNum = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
            }

            return (
                <div className="flex flex-col items-end leading-none">
                    <span className="font-bold">{formattedNum}</span>
                    <span className="text-[9px] text-gray-500 font-medium mt-0.5">{currencyLabel}</span>
                </div>
            )
        }


        return (
            <div ref={ref} className="p-8 bg-white text-black print:p-0 print:w-[80mm] print:text-sm">

                <div className="text-center mb-8">
                    {features.logo_url && (
                        <div className="flex justify-center mb-4">
                            <img
                                src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)}
                                alt="Workspace Logo"
                                className="h-16 w-auto object-contain"
                            />
                        </div>
                    )}
                    <h1 className="text-2xl font-bold uppercase tracking-widest mb-4">
                        {workspaceName || 'Asaas'}
                    </h1>
                    <div className="flex justify-between items-start text-xs text-gray-600 mb-4 border-b border-gray-200 pb-4">
                        <div className="text-start space-y-1">
                            <div>
                                <span className="font-semibold uppercase text-[10px] text-gray-400 block tracking-wider">{t('sales.date')}: </span>
                                <span className="font-mono">{formatDateTime(data.created_at)}</span>
                            </div>
                            <div className="mt-2">
                                <span className="font-semibold uppercase text-[10px] text-gray-400 block tracking-wider">{t('sales.id')}: </span>
                                <span className="font-mono">{data.invoiceid}</span>
                            </div>
                        </div>
                        <div className="text-end space-y-2">
                            <div>
                                <span className="font-semibold uppercase text-[10px] text-gray-400 block tracking-wider">{t('sales.cashier')}</span>
                                <span className="font-medium">{data.cashier_name}</span>
                            </div>
                            {data.payment_method && (
                                <div>
                                    <span className="font-semibold uppercase text-[10px] text-gray-400 block tracking-wider">{t('pos.paymentMethod') || 'Payment Method'}</span>
                                    <span className="font-medium">
                                        {data.payment_method === 'cash' ? (t('pos.cash') || 'Cash') :
                                            data.payment_method === 'fib' ? 'FIB' :
                                                data.payment_method === 'qicard' ? 'QiCard' :
                                                    data.payment_method === 'zaincash' ? 'ZainCash' :
                                                        data.payment_method === 'fastpay' ? 'FastPay' :
                                                            t('pos.cash') || 'Cash'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Exchange Rates Section */}
                    {data.exchange_rates && data.exchange_rates.length > 0 && (
                        <div className="mb-6 text-start">
                            <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-2">
                                {t('settings.exchangeRate.title')} {t('common.snapshots')}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {data.exchange_rates.map((rate: any, idx: number) => (
                                    <div key={idx} className="p-2 border border-gray-200 rounded bg-gray-50/50">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-[10px] font-bold">{rate.pair}</span>
                                            <span className="text-[9px] text-gray-400 uppercase">{rate.source}</span>
                                        </div>
                                        <div className="text-xs font-bold font-mono">
                                            100 {rate.pair.split('/')[0]} = {formatCurrency(rate.rate, rate.pair.split('/')[1].toLowerCase() as any, features.iqd_display_preference)}
                                        </div>
                                        <div className="text-[9px] text-gray-400 mt-1 font-mono opacity-80">
                                            {formatSnapshotTime(rate.timestamp)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-8">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-[10px] uppercase text-gray-400 border-b border-gray-200">
                                <th className="pb-2 text-start font-bold tracking-wider">{t('products.table.name')}</th>
                                <th className="pb-2 text-center font-bold tracking-wider">{t('common.quantity')}</th>
                                <th className="pb-2 text-end font-bold tracking-wider">{t('common.price')}</th>
                                <th className="pb-2 text-end font-bold tracking-wider">{t('common.total')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {data.items?.map((item, idx) => {
                                const isConverted = item.original_currency && item.settlement_currency && item.original_currency !== item.settlement_currency
                                return (
                                    <tr key={idx}>
                                        <td className="py-3 text-start align-top">
                                            <div className="font-bold text-sm">{item.product_name}</div>
                                            {item.product_sku && (
                                                <div className="text-[10px] text-gray-400 font-mono mt-0.5">{item.product_sku}</div>
                                            )}
                                        </td>
                                        <td className="py-3 text-center align-top font-mono">{item.quantity}</td>
                                        <td className="py-3 text-end align-top">
                                            <div className="flex flex-col items-end">
                                                {formatReceiptPrice(item.unit_price, data.settlement_currency || 'usd')}
                                                {isConverted && (
                                                    <div className="mt-1 opacity-60 scale-90 origin-right">
                                                        {formatReceiptPrice(item.original_unit_price || item.unit_price, item.original_currency || 'usd')}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 text-end align-top">
                                            <div className="flex flex-col items-end">
                                                {formatReceiptPrice(item.total_price || (item.unit_price * item.quantity), data.settlement_currency || 'usd')}
                                                {isConverted && (
                                                    <div className="mt-1 opacity-60 scale-90 origin-right line-through decoration-gray-400">
                                                        {formatReceiptPrice((item.original_unit_price || item.unit_price) * item.quantity, item.original_currency || 'usd')}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="border-t-2 border-black pt-4 mb-8">
                    <div className="flex justify-between items-end">
                        <span className="text-sm font-bold uppercase tracking-wider text-gray-500">{t('common.total')}</span>
                        <span className="text-3xl font-black tracking-tight">
                            {formatCurrency(data.total_amount, data.settlement_currency || 'usd', features.iqd_display_preference)}
                        </span>
                    </div>
                </div>

                <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-6">
                    <p className="mb-1 font-medium text-gray-900">{t('sales.receipt.thankYou')}</p>
                    <p>{t('sales.receipt.keepRecord')}</p>
                </div>
            </div>
        )
    }
)
SaleReceipt.displayName = 'SaleReceipt'
