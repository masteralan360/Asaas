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
import { XCircle, RotateCcw } from 'lucide-react'
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

    const returnedItemsCount = sale.items?.filter(item => item.is_returned).length || 0
    const partialReturnedItemsCount = sale.items?.filter(item => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
    const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('sales.details') || 'Sale Details'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {sale.is_returned && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                            <div className="flex items-center gap-2 text-destructive dark:text-destructive-foreground">
                                <XCircle className="w-5 h-5" />
                                <span className="font-medium">{t('sales.return.returnedMessage') || 'This sale has been returned'}</span>
                            </div>
                            {sale.return_reason && (
                                <p className="text-sm text-destructive/80 dark:text-destructive-foreground/80 mt-1">
                                    {t('sales.return.reason') || 'Reason'}: {sale.return_reason}
                                </p>
                            )}
                            {sale.returned_at && (
                                <p className="text-xs text-destructive/60 dark:text-destructive-foreground/60 mt-1">
                                    {t('sales.return.returnedAt') || 'Returned at'}: {formatDateTime(sale.returned_at)}
                                </p>
                            )}
                        </div>
                    )}

                    {!sale.is_returned && hasAnyReturn && (
                        <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                                <RotateCcw className="w-4 h-4" />
                                <span className="font-medium text-sm">
                                    {t('sales.return.partialReturnDetected') || 'This sale has partial returns.'}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
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
                            <div className="font-mono text-xs text-muted-foreground">{sale.id}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">{t('pos.paymentMethod') || 'Payment Method'}:</span>
                            <div className="font-medium flex items-center gap-2">
                                {sale.payment_method === 'fib' && (
                                    <>
                                        <img src="./icons/FIB24x24.jpg" alt="FIB" className="w-5 h-5 rounded" />
                                        FIB
                                    </>
                                )}
                                {sale.payment_method === 'qicard' && (
                                    <>
                                        <img src="./icons/QIcard24x24.png" alt="QiCard" className="w-5 h-5 rounded" />
                                        QiCard
                                    </>
                                )}
                                {sale.payment_method === 'zaincash' && (
                                    <>
                                        <img src="./icons/zain24x24.png" alt="ZainCash" className="w-5 h-5 rounded" />
                                        ZainCash
                                    </>
                                )}
                                {sale.payment_method === 'fastpay' && (
                                    <>
                                        <img src="./icons/fastpay24x24.jpg" alt="FastPay" className="w-5 h-5 rounded" />
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

                    <div className="border rounded-md overflow-hidden">
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
                                            className={isItemReturned ? 'bg-destructive/5 opacity-75' : hasItemPartialReturn ? 'bg-orange-500/5' : ''}
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
                                                        <span className="text-[10px] text-muted-foreground opacity-60">
                                                            <span className="line-through">{formatCurrency(originalUnitPrice, originalCurrency, features.iqd_display_preference)}</span> 🡆 <span className="font-bold">{formatCurrency(negotiatedPrice, originalCurrency, features.iqd_display_preference)}</span>
                                                        </span>
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
                                                        <span className={cn("text-[10px] text-muted-foreground opacity-60", isItemReturned && "opacity-30")}>
                                                            <span className="line-through">{formatCurrency(originalUnitPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span> 🡆 <span className="font-bold">{formatCurrency(negotiatedPrice * netQuantity, originalCurrency, features.iqd_display_preference)}</span>
                                                        </span>
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
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t">
                        <div className="text-lg font-bold uppercase tracking-tight opacity-70">
                            {t('sales.total')} ({sale.settlement_currency || 'usd'})
                        </div>
                        <div className="text-3xl font-black text-primary">
                            {formatCurrency(sale.total_amount, sale.settlement_currency || 'usd', features.iqd_display_preference)}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
