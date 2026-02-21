import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button
} from '@/ui/components'
import { Lock, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { BudgetReminderItem, ReminderCategory } from '@/lib/budgetReminders'

interface BudgetLockModalProps {
    isOpen: boolean
    onLock: () => void
    onSkip: () => void
    item: BudgetReminderItem | null
}

const ACCENT: Record<ReminderCategory, { color: string; bg: string; border: string; button: string }> = {
    expense: {
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/50',
        button: 'bg-amber-600 hover:bg-amber-700',
    },
    salary: {
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/50',
        button: 'bg-emerald-600 hover:bg-emerald-700',
    },
    dividend: {
        color: 'text-sky-600 dark:text-sky-400',
        bg: 'bg-sky-500/10',
        border: 'border-sky-500/50',
        button: 'bg-sky-600 hover:bg-sky-700',
    },
}

export function BudgetLockModal({ isOpen, onLock, onSkip, item }: BudgetLockModalProps) {
    const { t } = useTranslation()

    if (!item) return null

    const accent = ACCENT[item.category]

    return (
        <Dialog open={isOpen} onOpenChange={() => { /* controlled externally */ }}>
            <DialogContent
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                className={cn(
                    "max-w-sm w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                    "dark:bg-zinc-950/95 backdrop-blur-2xl shadow-2xl animate-in fade-in zoom-in duration-300",
                    "border-[3px]", accent.border
                )}
            >
                <div className="relative p-8 flex flex-col items-center text-center space-y-5">
                    {/* Background glow */}
                    <div className={cn("absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 blur-[60px] -z-10", accent.bg)} />

                    {/* Icon */}
                    <div className={cn("w-16 h-16 rounded-[1.5rem] flex items-center justify-center border", accent.bg, accent.border)}>
                        <ShieldCheck className={cn("w-8 h-8", accent.color)} />
                    </div>

                    {/* Content */}
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black tracking-tight text-center">
                            {t('budget.reminder.lockTitle', 'Lock this payment?')}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground text-center pt-2">
                            {t('budget.reminder.lockDesc', 'Locking prevents accidental edits. This action cannot be undone.')}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Item name */}
                    <div className={cn("px-4 py-2.5 rounded-xl border font-bold text-sm", accent.bg, accent.border, accent.color)}>
                        <Lock className="w-3.5 h-3.5 inline mr-2" />
                        {item.title}
                    </div>

                    {/* Actions */}
                    <DialogFooter className="w-full flex flex-col gap-3 sm:flex-col">
                        <Button
                            onClick={onLock}
                            className={cn(
                                "w-full h-12 rounded-2xl font-black shadow-lg border-t border-white/10 transition-all active:scale-95 text-white gap-2",
                                accent.button
                            )}
                        >
                            <Lock className="w-4 h-4" />
                            {t('budget.reminder.lockConfirm', 'Lock')}
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={onSkip}
                            className="w-full h-12 rounded-2xl font-bold text-muted-foreground transition-all active:scale-95"
                        >
                            {t('budget.reminder.lockSkip', 'Skip')}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
