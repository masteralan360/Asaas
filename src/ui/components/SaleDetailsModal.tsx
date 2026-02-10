import { useTranslation } from 'react-i18next'
import { Sale, SaleItem } from '@/types'
import { formatCurrency, formatDateTime, formatSnapshotTime, cn } from '@/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Button
} from '@/ui/components'
import { RotateCcw, ArrowRight, XCircle } from 'lucide-react'
import { isMobile } from '@/lib/platform'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'

interface SaleDetailsModalProps {
    sale: Sale | null
    isOpen: boolean
    onClose: () => void
    onReturnItem?: (item: SaleItem) => void
}

export function SaleDetailsModal({ sale, isOpen, onClose, onReturnItem }: SaleDetailsModalProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { features } = useWorkspace()

    if (!sale) return null

    const isFullyReturned = sale.is_returned || (sale.items && sale.items.length > 0 && sale.items.every(item =>
        item.is_returned || (item.returned_quantity || 0) >= item.quantity
    ))

    const returnedItemsCount = sale.items?.filter(item => item.is_returned).length || 0
    const partialReturnedItemsCount = sale.items?.filter(item => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
    const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0

    const netTotal = (() => {
        if (sale.is_returned) return 0
        if (sale.items && sale.items.length > 0) {
            const allItemsReturned = sale.items.every(item =>
                item.is_returned || (item.returned_quantity || 0) >= item.quantity
            )
            if (allItemsReturned) return 0

            return sale.items.reduce((sum, item) => {
                const quantity = item.quantity || 0
                const returnedQty = item.returned_quantity || 0
                const remainingQty = Math.max(0, quantity - returnedQty)

                if (remainingQty <= 0) return sum

                const unitPrice = item.converted_unit_price || item.unit_price || 0
                return sum + (unitPrice * remainingQty)
            }, 0)
        }
        return sale.total_amount
    })()

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto",
                "rounded-[2.5rem] border-[3px] border-primary/50 shadow-2xl transition-all duration-500"
            )}>
                <DialogHeader>
                    <DialogTitle>{t('sales.details') || 'Sale Details'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {sale.system_review_status === 'flagged' && (
                        <div className="relative p-4 overflow-hidden bg-orange-500/10 border border-orange-500/20 rounded-2xl group transition-all duration-300 hover:bg-orange-500/15">
                            <div className="absolute top-0 right-0 p-2 opacity-10 flex items-center justify-center pointer-events-none">
                                <span className="text-4xl">⚠️</span>
                            </div>
                            <div className="flex items-start gap-4 relative z-10">
                                <div className="p-2.5 rounded-xl bg-orange-500/20 text-orange-600 dark:text-orange-400">
                                    <span className="text-xl">⚠️</span>
                                </div>
                                <div className="space-y-1">
                                    <span className="font-black text-xs block uppercase tracking-[0.1em] text-orange-600 dark:text-orange-400">
                                        {t('sales.flagged') || 'System Review Flagged'}
                                    </span>
                                    <p className="text-sm font-medium text-orange-950/80 dark:text-orange-200/80 leading-relaxed">
                                        {sale.system_review_reason || 'Inconsistent checkout data detected.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {isFullyReturned && (
                        <div className="relative p-4 overflow-hidden bg-destructive/10 border border-destructive/20 rounded-2xl group transition-all duration-300 hover:bg-destructive/15">
                            <div className="flex items-center gap-4 relative z-10 text-destructive dark:text-destructive-foreground">
                                <div className="p-3 rounded-xl bg-destructive/20 flex items-center justify-center">
                                    <XCircle className="w-6 h-6" />
                                </div>
                                <div className="space-y-1">
                                    <span className="font-black text-xs block uppercase tracking-[0.1em]">
                                        {t('sales.return.returnedStatus') || 'Fully Returned'}
                                    </span>
                                    <p className="text-base font-bold">
                                        {t('sales.return.returnedMessage') || 'This sale has been returned'}
                                    </p>
                                    <div className="flex flex-col gap-0.5 opacity-80">
                                        {sale.return_reason && (
                                            <p className="text-xs font-semibold">
                                                {t('sales.return.reason') || 'Reason'}: {sale.return_reason}
                                            </p>
                                        )}
                                        {sale.returned_at && (
                                            <p className="text-[10px] font-medium opacity-60">
                                                {t('sales.return.returnedAt') || 'Returned at'}: {formatDateTime(sale.returned_at)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {!isFullyReturned && hasAnyReturn && (
                        <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-500">
                            <div className="p-2 rounded-lg bg-orange-500/20 text-orange-600 dark:text-orange-400">
                                <RotateCcw className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-xs uppercase tracking-wide text-orange-600 dark:text-orange-400">
                                {t('sales.return.partialReturnDetected') || 'This sale has partial returns.'}
                            </span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
                        {/* ... Info content stays same ... */}
                        <div>
                            <span className="text-muted-foreground">{t('sales.date')}:</span>
                            <div className="font-medium">{formatDateTime(sale.created_at)}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('sales.cashier')}:</span>
                            <div className="font-medium">{sale.cashier_name || 'Staff'}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('sales.id')}:</span>
                            <div className="flex items-center gap-2">
                                {sale.sequenceId ? (
                                    <>
                                        <span className="font-mono text-xs font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                                            #{String(sale.sequenceId).padStart(5, '0')}
                                        </span>
                                        <span className="font-mono text-[10px] text-muted-foreground/50">
                                            ({sale.id.slice(0, 8)})
                                        </span>
                                    </>
                                ) : (
                                    <div className="font-mono text-xs text-muted-foreground">{sale.id}</div>
                                )}
                            </div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('pos.paymentMethod') || 'Payment Method'}:</span>
                            <div className="font-medium flex items-center gap-2">
                                {sale.payment_method === 'fib' && (
                                    <>
                                        <img src="./icons/fib.svg" alt="FIB" className="w-5 h-5 rounded" />
                                        FIB
                                    </>
                                )}
                                {sale.payment_method === 'qicard' && (
                                    <>
                                        <img src="./icons/qi.svg" alt="QiCard" className="w-5 h-5 rounded" />
                                        QiCard
                                    </>
                                )}
                                {sale.payment_method === 'zaincash' && (
                                    <>
                                        <img src="./icons/zain.svg" alt="ZainCash" className="w-5 h-5 rounded" />
                                        ZainCash
                                    </>
                                )}
                                {sale.payment_method === 'fastpay' && (
                                    <>
                                        <img src="./icons/fastpay.svg" alt="FastPay" className="w-5 h-5 rounded" />
                                        FastPay
                                    </>
                                )}
                                {(!sale.payment_method || sale.payment_method === 'cash') && (
                                    <span>{t('pos.cash') || 'Cash'}</span>
                                )}
                            </div>
                        </div>
                        {sale.exchange_rates && sale.exchange_rates.length > 0 ? (
                            <div className="col-span-2 space-y-2">
                                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
                                    {t('settings.exchangeRate.title')} {t('common.snapshots')}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {sale.exchange_rates.map((rate: any, idx: number) => (
                                        <div key={idx} className="p-2 bg-muted/30 rounded border border-border/50 flex flex-col gap-0.5">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-bold text-primary/70">{rate.pair}</span>
                                                <span className="text-[9px] text-muted-foreground italic uppercase">{rate.source}</span>
                                            </div>
                                            <div className="text-sm font-bold">
                                                100 {rate.pair.split('/')[0]} = {formatCurrency(rate.rate, rate.pair.split('/')[1].toLowerCase() as any, features.iqd_display_preference)}
                                            </div>
                                            <div className="text-[9px] text-muted-foreground opacity-70">
                                                {formatSnapshotTime(rate.timestamp)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (sale.exchange_rate ?? 0) > 0 && (
                            <div className="p-3 bg-muted/30 rounded-lg col-span-2 flex items-center justify-between border border-border/50">
                                <div className="space-y-0.5">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                                        {t('settings.exchangeRate.title')} ({sale.exchange_source})
                                    </div>
                                    <div className="text-sm font-black">
                                        100 USD = {formatCurrency(sale.exchange_rate, 'iqd', features.iqd_display_preference)}
                                    </div>
                                </div>
                                <div className="text-[10px] text-muted-foreground text-right">
                                    {formatSnapshotTime(sale.exchange_rate_timestamp)}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border rounded-xl font-medium overflow-hidden">
                        {isMobile() ? (
                            <div className="divide-y divide-border">
                                {sale.items?.map((item) => {
                                    const isItemReturned = item.is_returned || sale.is_returned
                                    const hasItemPartialReturn = (item.returned_quantity || 0) > 0 && !item.is_returned
                                    const displayUnitPrice = item.converted_unit_price || item.unit_price || 0
                                    const displayCurrency = (sale.settlement_currency || 'usd') as any
                                    const netQuantity = item.quantity - (item.returned_quantity || 0)

                                    const isConverted = item.original_currency && item.settlement_currency && item.original_currency !== item.settlement_currency
                                    const hasNegotiated = item.negotiated_price !== undefined && item.negotiated_price !== null && item.negotiated_price > 0
                                    const originalUnitPrice = item.original_unit_price || item.unit_price || 0
                                    const originalCurrency = (item.original_currency || 'usd') as any
                                    const negotiatedPrice = item.negotiated_price || 0

                                    return (
                                        <div
                                            key={item.id}
                                            className={cn(
                                                "p-4 space-y-3 transition-colors duration-300",
                                                isItemReturned ? 'bg-destructive/5 border-l-4 border-destructive' :
                                                    hasItemPartialReturn ? 'bg-orange-500/5 border-l-4 border-orange-500' :
                                                        'hover:bg-muted/30 border-l-4 border-transparent'
                                            )}
                                        >
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <div className={cn("font-bold text-sm", isItemReturned && "line-through opacity-50")}>
                                                            {item.product_name}
                                                        </div>
                                                        {hasNegotiated && (
                                                            <span className="px-1.5 py-0.5 text-[8px] font-black bg-emerald-500/10 text-emerald-600 rounded-full uppercase">
                                                                {t('pos.negotiatedPrice') || 'Negotiated'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground font-mono">{item.product_sku}</div>
                                                </div>
                                                <div className="flex gap-1 shrink-0">
                                                    {isItemReturned && (
                                                        <span className="px-1.5 py-0.5 text-[8px] font-black bg-destructive/10 text-destructive rounded-full uppercase">
                                                            {t('sales.return.returnedStatus')}
                                                        </span>
                                                    )}
                                                    {hasItemPartialReturn && !isItemReturned && (
                                                        <span className="px-1.5 py-0.5 text-[8px] font-black bg-orange-500/10 text-orange-600 rounded-full uppercase">
                                                            {t('sales.return.partialReturn')}
                                                        </span>
                                                    )}
                                                    {!isItemReturned && !item.is_returned && onReturnItem && (user?.role === 'admin' || user?.role === 'staff') && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                onReturnItem(item)
                                                            }}
                                                            className="h-7 w-7 p-0 text-orange-600 hover:bg-orange-50 rounded-lg"
                                                        >
                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 mt-2">
                                                <div className="space-y-1">
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">
                                                        {t('common.quantity')}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-baseline gap-1.5">
                                                            <span className={cn("text-base font-black", isItemReturned && "line-through opacity-50")}>
                                                                {netQuantity}
                                                            </span>
                                                            {(hasItemPartialReturn || isItemReturned) && (
                                                                <span className="text-[10px] text-muted-foreground opacity-60 line-through">
                                                                    {item.quantity}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {hasItemPartialReturn && !isItemReturned && (
                                                            <div className="text-[9px] text-orange-600 font-bold leading-none mt-0.5">
                                                                -{item.returned_quantity} {t('sales.return.returnedLabel') || 'returned'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight text-right">
                                                        {t('common.price')}
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <span className={cn(
                                                            "text-sm font-bold",
                                                            hasNegotiated ? "text-emerald-600" : "text-foreground",
                                                            isItemReturned && "opacity-50"
                                                        )}>
                                                            {formatCurrency(displayUnitPrice, displayCurrency, features.iqd_display_preference)}
                                                        </span>
                                                        {hasNegotiated && (
                                                            <div className="flex items-center justify-end gap-1 text-[9px] text-muted-foreground opacity-60 mt-0.5">
                                                                <span className="line-through">{formatCurrency(originalUnitPrice, originalCurrency, features.iqd_display_preference)}</span>
                                                                <ArrowRight className="w-2 h-2" />
                                                                <span className="font-bold">{formatCurrency(negotiatedPrice, originalCurrency, features.iqd_display_preference)}</span>
                                                            </div>
                                                        )}
                                                        {!hasNegotiated && isConverted && (
                                                            <span className="text-[9px] text-muted-foreground line-through opacity-60 mt-0.5">
                                                                {formatCurrency(originalUnitPrice, originalCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-1 pt-2 border-t border-border">
                                                <div className="flex justify-between items-center">
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">
                                                        {t('common.total')}
                                                    </div>
                                                    <div className={cn("text-base font-black text-primary", isItemReturned && "line-through opacity-50")}>
                                                        {formatCurrency(displayUnitPrice * netQuantity, displayCurrency, features.iqd_display_preference)}
                                                    </div>
                                                </div>
                                                {(hasNegotiated || isConverted) && (
                                                    <div className="flex justify-end mt-[-4px]">
                                                        {hasNegotiated ? (
                                                            <div className={cn("flex items-center justify-end gap-1 text-[9px] text-muted-foreground opacity-60", isItemReturned && "opacity-30")}>
                                                                <span className="line-through">{formatCurrency(originalUnitPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span>
                                                                <ArrowRight className="w-2 h-2" />
                                                                <span className="font-bold">{formatCurrency(negotiatedPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span>
                                                            </div>
                                                        ) : (
                                                            <span className={cn("text-[9px] text-muted-foreground line-through opacity-50", isItemReturned && "opacity-30")}>
                                                                {formatCurrency(originalUnitPrice * netQuantity, originalCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-start">{t('products.table.name')}</TableHead>
                                        <TableHead className="text-end">{t('common.quantity')}</TableHead>
                                        <TableHead className="text-end">{t('common.price')}</TableHead>
                                        <TableHead className="text-end">{t('common.total')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sale.items?.map((item) => {
                                        const isConverted = item.original_currency && item.settlement_currency && item.original_currency !== item.settlement_currency
                                        const hasNegotiated = item.negotiated_price !== undefined && item.negotiated_price !== null && item.negotiated_price > 0
                                        const isItemReturned = item.is_returned || sale.is_returned
                                        const hasItemPartialReturn = (item.returned_quantity || 0) > 0 && !item.is_returned

                                        let displayUnitPrice: number = item.converted_unit_price || item.unit_price || 0
                                        let displayCurrency: string = sale.settlement_currency || 'usd'

                                        const originalUnitPrice = item.original_unit_price || item.unit_price || 0
                                        const originalCurrency = item.original_currency || 'usd'
                                        const negotiatedPrice = item.negotiated_price || 0

                                        const netQuantity = item.quantity - (item.returned_quantity || 0)

                                        return (
                                            <TableRow
                                                key={item.id}
                                                className={cn(
                                                    "transition-colors duration-300",
                                                    isItemReturned ? 'bg-destructive/5 opacity-80' :
                                                        hasItemPartialReturn ? 'bg-orange-500/5' :
                                                            'hover:bg-muted/30'
                                                )}
                                            >
                                                <TableCell className="text-start">
                                                    <div className="flex items-center gap-2">
                                                        <div>
                                                            <div className={cn("font-medium", isItemReturned && "line-through opacity-50")}>
                                                                {item.product_name}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">{item.product_sku}</div>
                                                            {hasNegotiated && (
                                                                <div className="text-[10px] text-emerald-600 font-medium">
                                                                    {t('pos.negotiatedPrice') || 'Negotiated'}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {isItemReturned && (
                                                            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-destructive/10 text-destructive rounded-full uppercase">
                                                                {t('sales.return.returnedStatus')}
                                                            </span>
                                                        )}
                                                        {hasItemPartialReturn && !isItemReturned && (
                                                            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-orange-500/10 text-orange-600 rounded-full uppercase">
                                                                {t('sales.return.partialReturn')}
                                                            </span>
                                                        )}
                                                        {!isItemReturned && !item.is_returned && onReturnItem && (user?.role === 'admin' || user?.role === 'staff') && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    onReturnItem(item)
                                                                }}
                                                                className="h-6 w-6 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                                                title={t('sales.return.returnItem') || 'Return Item'}
                                                            >
                                                                <RotateCcw className="h-3 w-3" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-end font-mono">
                                                    <div className="flex flex-col items-end">
                                                        <span className={cn("text-sm font-semibold", isItemReturned && "line-through opacity-50")}>
                                                            {netQuantity}
                                                        </span>
                                                        {(hasItemPartialReturn || isItemReturned) && (
                                                            <div className="text-[10px] text-muted-foreground opacity-60 line-through whitespace-nowrap">
                                                                {item.quantity} {t('common.total') || 'Total'}
                                                            </div>
                                                        )}
                                                        {hasItemPartialReturn && !isItemReturned && (
                                                            <div className="text-[10px] text-orange-600 font-medium whitespace-nowrap">
                                                                -{item.returned_quantity} {t('sales.return.returnedLabel') || 'returned'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-end">
                                                    <div className="flex flex-col items-end">
                                                        <span className={cn(
                                                            hasNegotiated ? "font-medium text-emerald-600" : "font-medium",
                                                            isItemReturned && "opacity-50"
                                                        )}>
                                                            {formatCurrency(displayUnitPrice, displayCurrency, features.iqd_display_preference)}
                                                        </span>
                                                        {hasNegotiated && (
                                                            <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground opacity-60">
                                                                <span className="line-through">{formatCurrency(originalUnitPrice, originalCurrency, features.iqd_display_preference)}</span>
                                                                <ArrowRight className="w-2.5 h-2.5" />
                                                                <span className="font-bold">{formatCurrency(negotiatedPrice, originalCurrency, features.iqd_display_preference)}</span>
                                                            </div>
                                                        )}
                                                        {!hasNegotiated && isConverted && (
                                                            <span className="text-[10px] text-muted-foreground line-through opacity-60">
                                                                {formatCurrency(originalUnitPrice, originalCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-end font-bold">
                                                    <div className="flex flex-col items-end">
                                                        <span className={cn(
                                                            hasNegotiated ? "text-emerald-600" : "",
                                                            isItemReturned && "line-through opacity-50"
                                                        )}>
                                                            {formatCurrency(displayUnitPrice * netQuantity, displayCurrency, features.iqd_display_preference)}
                                                        </span>

                                                        {(hasItemPartialReturn || isItemReturned) && (
                                                            <span className="text-[10px] text-muted-foreground opacity-40 line-through">
                                                                {formatCurrency(displayUnitPrice * item.quantity, displayCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}

                                                        {hasNegotiated && (
                                                            <div className={cn("flex items-center justify-end gap-1 text-[10px] text-muted-foreground opacity-60", isItemReturned && "opacity-30")}>
                                                                <span className="line-through">{formatCurrency(originalUnitPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span>
                                                                <ArrowRight className="w-2.5 h-2.5" />
                                                                <span className="font-bold">{formatCurrency(negotiatedPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span>
                                                            </div>
                                                        )}
                                                        {!hasNegotiated && isConverted && (
                                                            <span className={cn("text-[10px] text-muted-foreground line-through opacity-50", isItemReturned && "opacity-30")}>
                                                                {formatCurrency(originalUnitPrice * netQuantity, originalCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t">
                        <div className="text-lg font-bold uppercase tracking-tight opacity-70">
                            {t('sales.total')} ({sale.settlement_currency || 'usd'})
                        </div>
                        <div className="flex items-center gap-3">
                            {hasAnyReturn && (
                                <span className="text-xl font-bold text-muted-foreground line-through opacity-40 tabular-nums">
                                    {formatCurrency(sale.total_amount, sale.settlement_currency || 'usd', features.iqd_display_preference)}
                                </span>
                            )}
                            <div className="text-3xl font-black text-primary tabular-nums drop-shadow-sm">
                                {formatCurrency(netTotal, sale.settlement_currency || 'usd', features.iqd_display_preference)}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog >
    )
}
