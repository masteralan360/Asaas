import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SaleItem } from '@/types'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import { localizeReturnReason } from '@/lib/returnReasons'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Button,
} from '@/ui/components'
import { RotateCcw, CircleAlert } from 'lucide-react'
import { useTheme } from '@/ui/components/theme-provider'
import { useWorkspaceUsers, type IQDDisplayPreference } from '@/local-db'

interface PartialReturnInfoModalProps {
    item: SaleItem
    isOpen: boolean
    onClose: () => void
    settlementCurrency?: string
    iqdDisplayPreference?: IQDDisplayPreference
    workspaceId?: string
}

export function PartialReturnInfoModal({
    item,
    isOpen,
    onClose,
    settlementCurrency = 'usd',
    iqdDisplayPreference,
    workspaceId,
}: PartialReturnInfoModalProps) {
    const { t, i18n } = useTranslation()
    const { style } = useTheme()
    const users = useWorkspaceUsers(workspaceId)
    const userMap = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users])

    if (!item) return null

    const displayCurrency = settlementCurrency as any
    const returnedQty = item.returned_quantity || 0
    const originalQty = item.quantity || 0
    const netQty = Math.max(0, originalQty - returnedQty)

    const localizedReason = localizeReturnReason(
        item.return_reason,
        i18n,
        i18n.language,
        t('invoice.refund.notProvided') || 'Not provided'
    )

    const unitPrice = item.converted_unit_price || item.unit_price || 0
    const returnedAmount = unitPrice * returnedQty

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-md w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-300",
                "rounded-[2rem] border-[3px] border-orange-500/50 bg-background/95 backdrop-blur-3xl",
                style === 'neo-orange' && "neo-border rounded-none"
            )}>
                <DialogHeader>
                    <DialogTitle className="text-xl font-black text-foreground tracking-tight flex items-center gap-2">
                        <div className="p-1.5 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400">
                            <RotateCcw className="w-5 h-5" />
                        </div>
                        {t('sales.return.partialReturnInfo') || 'Partial Return Information'}
                    </DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-6">
                    {/* Product Name */}
                    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                            {t('products.table.name') || 'Product'}
                        </div>
                        <div className="font-bold text-base">{item.product_name}</div>
                        {item.product_sku && (
                            <div className="text-xs text-muted-foreground font-mono">{item.product_sku}</div>
                        )}
                    </div>

                    {/* Quantity Breakdown */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
                            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                {t('common.quantity') || 'Qty'}
                            </div>
                            <div className="mt-1 text-lg font-black">{originalQty}</div>
                        </div>
                        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 text-center">
                            <div className="text-[10px] uppercase font-bold tracking-wider text-orange-600 dark:text-orange-400">
                                {t('sales.return.returnedLabel') || 'Returned'}
                            </div>
                            <div className="mt-1 text-lg font-black text-orange-600 dark:text-orange-400">
                                -{returnedQty}
                            </div>
                        </div>
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
                            <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400">
                                {t('sales.return.remaining') || 'Remaining'}
                            </div>
                            <div className="mt-1 text-lg font-black text-emerald-600 dark:text-emerald-400">
                                {netQty}
                            </div>
                        </div>
                    </div>

                    {/* Return Reason */}
                    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <CircleAlert className="w-4 h-4 text-orange-600 shrink-0" />
                            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                {t('sales.return.reason') || 'Return Reason'}
                            </span>
                        </div>
                        <div className="font-semibold text-sm">{localizedReason}</div>
                    </div>

                    {/* Returned Amount */}
                    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                            {t('sales.return.returnedAmount') || 'Returned Amount'}
                        </div>
                        <div className="font-black text-lg text-destructive">
                            {formatCurrency(returnedAmount, displayCurrency, iqdDisplayPreference)}
                        </div>
                    </div>

                    {/* Returned At */}
                    {item.returned_at && (
                        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
                            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                {t('sales.return.returnedAt') || 'Returned At'}
                            </div>
                            <div className="font-semibold text-sm">
                                {formatDateTime(item.returned_at)}
                            </div>
                        </div>
                    )}

                    {/* Returned By */}
                    {item.returned_by && (
                        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
                            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                {t('sales.return.returnedBy') || 'Returned By'}
                            </div>
                            <div className="font-semibold text-sm">
                                {userMap.get(item.returned_by) || item.returned_by}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="h-11 px-8 text-sm font-bold"
                    >
                        {t('common.close') || 'Close'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
