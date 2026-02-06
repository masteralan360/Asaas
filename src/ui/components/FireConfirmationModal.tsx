import { useTranslation } from 'react-i18next'
import { Plus, UserMinus, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'

interface FireConfirmationModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    employeeName: string
    isFired: boolean
    isLoading?: boolean
}

export function FireConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    employeeName,
    isFired,
    isLoading = false
}: FireConfirmationModalProps) {
    const { t } = useTranslation()

    const title = isFired ? t('hr.confirmRehire', 'Confirm Re-hire') : t('hr.confirmFire', 'Confirm Suspension / Firing')
    const description = isFired 
        ? t('hr.rehireWarning', 'Are you sure you want to re-hire this employee? They will be restored to active status and their salary will be included in the budget.')
        : t('hr.fireWarning', 'Are you sure you want to fire/suspend this employee? They will remain in the records but their costs will be zeroed in the budget.')

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-md w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                "dark:bg-zinc-950/90 backdrop-blur-2xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300"
            )}>
                <div className="relative p-8 flex flex-col items-center text-center space-y-6">
                    {/* Background Glow */}
                    <div className={cn(
                        "absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 blur-[60px] -z-10",
                        isFired ? "bg-primary/20" : "bg-destructive/20"
                    )} />

                    {/* Icon Container */}
                    <div className="relative">
                        <div className={cn(
                            "w-20 h-20 rounded-[2rem] flex items-center justify-center border animate-pulse-subtle",
                            isFired ? "bg-primary/10 border-primary/20" : "bg-destructive/10 border-destructive/20"
                        )}>
                            {isFired ? (
                                <Plus className="w-10 h-10 text-primary" />
                            ) : (
                                <UserMinus className="w-10 h-10 text-destructive" />
                            )}
                        </div>
                        {!isFired && (
                            <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center shadow-lg">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="space-y-2">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-foreground tracking-tight text-center">
                                {title}
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground font-medium text-sm leading-relaxed px-4">
                            {description}
                        </p>
                    </div>

                    {/* Employee Preview */}
                    <div className="w-full bg-muted/30 p-4 rounded-2xl border border-border/50 flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                            {t('hr.employee', 'Employee')}
                        </span>
                        <span className="text-base font-bold text-foreground truncate">
                            {employeeName}
                        </span>
                    </div>

                    {/* Actions */}
                    <DialogFooter className="w-full grid grid-cols-2 gap-3 sm:gap-4 !flex-row sm:!flex-row">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={isLoading}
                            className="h-12 rounded-2xl font-bold bg-secondary/30 hover:bg-secondary/50 border border-transparent hover:border-border/50 transition-all"
                        >
                            {t('common.cancel', 'Cancel')}
                        </Button>
                        <Button
                            variant={isFired ? "default" : "destructive"}
                            onClick={onConfirm}
                            disabled={isLoading}
                            className={cn(
                                "h-12 rounded-2xl font-black shadow-lg border-t border-white/10 flex gap-2 items-center justify-center transition-all active:scale-95",
                                isFired ? "shadow-primary/20" : "shadow-destructive/20"
                            )}
                        >
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    {isFired ? <Plus className="w-4 h-4" /> : <UserMinus className="w-4 h-4" />}
                                    {isFired ? t('hr.rehire', 'Re-hire') : t('hr.fire', 'Fire / Suspend')}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
