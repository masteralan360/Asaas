import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'
import { AlertCircle } from 'lucide-react'

interface ReturnDeclineModalProps {
    isOpen: boolean
    onClose: () => void
    products: string[]
    returnableProducts?: string[]
    onContinue?: () => void
}

export function ReturnDeclineModal({ isOpen, onClose, products, returnableProducts, onContinue }: ReturnDeclineModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto border-destructive/30 shadow-2xl shadow-destructive/10 dark:shadow-destructive/20 dark:bg-zinc-950/90 backdrop-blur-xl animate-in fade-in zoom-in duration-300">
                <DialogHeader className="space-y-2">
                    <DialogTitle className="flex items-center gap-2 text-xl font-black text-destructive dark:drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                        <AlertCircle className="w-8 h-8" />
                        {t('sales.return.declineTitle') || 'Return Not Possible'}
                    </DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4 overflow-y-auto max-h-[65vh] pr-1">
                    <div className="space-y-3">
                        <p className="text-base text-foreground font-semibold leading-relaxed px-1">
                            {t('sales.return.declineMessage') || 'The following products in this sale are marked as non-returnable:'}
                        </p>
                        <div className="bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 dark:border-destructive/30 rounded-2xl p-4 space-y-2 mx-1">
                            {products.map((name, index) => (
                                <div key={index} className="flex items-center gap-3 text-sm text-destructive font-bold font-mono">
                                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                                    {name}
                                </div>
                            ))}
                        </div>
                    </div>

                    {returnableProducts && returnableProducts.length > 0 && (
                        <div className="space-y-3">
                            <p className="text-base text-emerald-600 dark:text-emerald-400 font-semibold leading-relaxed px-1">
                                {t('sales.return.returnableMessage') || 'The following products are returnable:'}
                            </p>
                            <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-500/30 rounded-2xl p-4 space-y-2 mx-1">
                                {returnableProducts.map((name, index) => (
                                    <div key={index} className="flex items-center gap-3 text-sm text-emerald-600 dark:text-emerald-400 font-bold font-mono">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        {name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground italic bg-muted/40 p-4 rounded-xl border border-border/50 mx-1">
                        {t('sales.return.declineNote') || 'Please contact an administrator if you believe this is an error.'}
                    </p>
                </div>
                <DialogFooter className="flex flex-col-reverse sm:flex-row gap-3 p-1">
                    <Button
                        variant="destructive"
                        onClick={onClose}
                        className="w-full sm:w-auto h-12 px-6 text-base font-bold shadow-lg shadow-destructive/20 hover:shadow-destructive/40 transition-all duration-300 sm:flex-1"
                    >
                        {onContinue ? t('common.cancel') : t('common.done')}
                    </Button>
                    {onContinue && (
                        <Button
                            variant="secondary"
                            onClick={onContinue}
                            className="w-full sm:w-auto h-12 px-6 text-base font-bold shadow-lg transition-all duration-300 sm:flex-[2] bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-foreground border border-zinc-200 dark:border-zinc-700"
                        >
                            {t('return.continueWithReturnable')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

