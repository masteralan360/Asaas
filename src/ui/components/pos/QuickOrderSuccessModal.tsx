import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2, ClipboardCheck, X } from 'lucide-react'

import type { CurrencyCode, SalesOrder } from '@/local-db'
import { formatCurrency } from '@/lib/utils'
import type { WorkspaceFeatures } from '@/workspace'
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from '@/ui/components'

export interface CompletedQuickOrder {
    id: string
    orderNumber: string
    total: number
    currency: CurrencyCode
    status: Extract<SalesOrder['status'], 'draft' | 'pending' | 'completed'>
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
    const successTitle = order?.status === 'completed'
        ? t('pos.quickOrder.completedTitle', { defaultValue: 'Order Completed' })
        : t('pos.quickOrder.savedTitle', { defaultValue: 'Order Saved' })

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                onOpenAutoFocus={(event) => event.preventDefault()}
                showCloseButton={false}
                className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm gap-0 overflow-y-auto rounded-[2.5rem] border-none p-0 shadow-2xl animate-in fade-in zoom-in duration-300"
            >
                <DialogTitle className="sr-only">
                    {successTitle}
                </DialogTitle>

                <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-primary p-5 text-primary-foreground sm:p-6">
                    <DialogClose asChild>
                        <button
                            type="button"
                            className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-primary-foreground transition-colors hover:bg-black/20 rtl:right-auto rtl:left-3"
                            aria-label={t('common.close')}
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </DialogClose>
                    <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
                    <div className="absolute -bottom-12 -left-12 h-24 w-24 rounded-full bg-black/10 blur-2xl" />
                    <div className="rounded-full bg-white/20 p-3 backdrop-blur-md animate-in zoom-in duration-500">
                        <CheckCircle2 className="h-16 w-16" />
                    </div>
                    <div className="space-y-0.5 text-center">
                        <h2 className="text-xl font-black tracking-tight">
                            {successTitle}
                        </h2>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                            {order?.orderNumber}
                        </p>
                        {order ? (
                            <p className="text-xs font-semibold text-white/80">
                                {t('pos.quickOrder.savedWithStatus', {
                                    status: t(`orders.status.${order.status}`)
                                })}
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="space-y-5 p-5 sm:space-y-6 sm:p-6">
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
                            className="h-auto min-h-12 w-full whitespace-normal rounded-xl px-4 py-3 text-base leading-tight shadow-lg shadow-primary/20 transition-all active:scale-95"
                            onClick={onOpenOrderDetails}
                            disabled={!order}
                        >
                            <ClipboardCheck className="h-5 w-5" />
                            <span className="min-w-0 text-center">
                                {t('pos.quickOrder.openDetails', { defaultValue: 'Open Order Details' })}
                            </span>
                            <ArrowRight className="h-5 w-5 rtl:rotate-180" />
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-auto min-h-12 w-full whitespace-normal rounded-xl border-2 px-4 py-3 text-base leading-tight transition-all active:scale-95"
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
