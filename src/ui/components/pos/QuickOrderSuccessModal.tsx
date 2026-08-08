import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2, ClipboardCheck } from 'lucide-react'

import type { CurrencyCode } from '@/local-db'
import { formatCurrency } from '@/lib/utils'
import type { WorkspaceFeatures } from '@/workspace'
import { Button, Dialog, DialogContent, DialogTitle } from '@/ui/components'

export interface CompletedQuickOrder {
    id: string
    orderNumber: string
    total: number
    currency: CurrencyCode
}

interface QuickOrderSuccessModalProps {
    isOpen: boolean
    order: CompletedQuickOrder | null
    iqdPreference: WorkspaceFeatures['iqd_display_preference']
    onClose: () => void
    onOpenOrderDetails: () => void
}

/**
 * Intentionally separate from the POS sale receipt modal. Quick Orders are
 * Sales Orders, so their completion screen must never share POS-sale state,
 * printing, or receipt timers.
 */
export function QuickOrderSuccessModal({
    isOpen,
    order,
    iqdPreference,
    onClose,
    onOpenOrderDetails
}: QuickOrderSuccessModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="max-w-sm overflow-hidden rounded-[2.5rem] border-none p-0 shadow-2xl animate-in fade-in zoom-in duration-300"
            >
                <DialogTitle className="sr-only">
                    {t('pos.quickOrder.completedTitle', { defaultValue: 'Order Completed' })}
                </DialogTitle>

                <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-primary p-6 text-primary-foreground">
                    <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
                    <div className="absolute -bottom-12 -left-12 h-24 w-24 rounded-full bg-black/10 blur-2xl" />
                    <div className="rounded-full bg-white/20 p-3 backdrop-blur-md animate-in zoom-in duration-500">
                        <CheckCircle2 className="h-16 w-16" />
                    </div>
                    <div className="space-y-0.5 text-center">
                        <h2 className="text-xl font-black tracking-tight">
                            {t('pos.quickOrder.completedTitle', { defaultValue: 'Order Completed' })}
                        </h2>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                            {order?.orderNumber}
                        </p>
                    </div>
                </div>

                <div className="space-y-6 p-6">
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground/50">
                            {t('common.total', { defaultValue: 'Total' })}
                        </span>
                        <div className="text-4xl font-black text-foreground">
                            {order ? formatCurrency(order.total, order.currency, iqdPreference) : '-'}
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Button
                            size="lg"
                            className="h-14 w-full rounded-xl text-lg shadow-lg shadow-primary/20 transition-all active:scale-95"
                            onClick={onOpenOrderDetails}
                            disabled={!order}
                        >
                            <ClipboardCheck className="mr-3 h-6 w-6" />
                            {t('pos.quickOrder.openDetails', { defaultValue: 'Open Order Details' })}
                            <ArrowRight className="ml-auto h-5 w-5" />
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-14 w-full rounded-xl border-2 text-lg transition-all active:scale-95"
                            onClick={onClose}
                        >
                            {t('pos.continueSale', { defaultValue: 'Continue' })}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
