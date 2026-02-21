import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'
import { Receipt, Wallet, TrendingUp, Calendar, BellOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { BudgetReminderItem, ReminderCategory } from '@/lib/budgetReminders'

interface BudgetReminderModalProps {
    isOpen: boolean
    onPaid: () => void
    onSnooze: () => void
    item: BudgetReminderItem | null
    queuePosition?: number
    queueTotal?: number
    iqdPreference?: string
}

const THEME: Record<ReminderCategory, {
    icon: typeof Receipt
    color: string
    bg: string
    border: string
    glow: string
    badge: string
    button: string
}> = {
    expense: {
        icon: Receipt,
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/50',
        glow: 'shadow-amber-500/20',
        badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
        button: 'bg-amber-600 hover:bg-amber-700',
    },
    salary: {
        icon: Wallet,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/50',
        glow: 'shadow-emerald-500/20',
        badge: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
        button: 'bg-emerald-600 hover:bg-emerald-700',
    },
    dividend: {
        icon: TrendingUp,
        color: 'text-sky-600 dark:text-sky-400',
        bg: 'bg-sky-500/10',
        border: 'border-sky-500/50',
        glow: 'shadow-sky-500/20',
        badge: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
        button: 'bg-sky-600 hover:bg-sky-700',
    },
}

export function BudgetReminderModal({
    isOpen,
    onPaid,
    onSnooze,
    item,
    queuePosition = 1,
    queueTotal = 1,
    iqdPreference
}: BudgetReminderModalProps) {
    const { t } = useTranslation()

    if (!item) return null

    const theme = THEME[item.category]
    const Icon = theme.icon
    const dueDate = new Date(item.dueDate)
    const now = new Date()
    const isOverdue = dueDate < now
    const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    return (
        <Dialog open={isOpen} onOpenChange={() => { /* controlled externally */ }}>
            <DialogContent
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                className={cn(
                    "max-w-md w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                    "dark:bg-zinc-950/95 backdrop-blur-2xl shadow-2xl animate-in fade-in zoom-in duration-300",
                    "border-[3px]", theme.border, theme.glow
                )}
            >
                <div className="relative p-8 flex flex-col items-center text-center space-y-5">
                    {/* Background glow */}
                    <div className={cn("absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 blur-[60px] -z-10", theme.bg)} />

                    {/* Queue badge */}
                    {queueTotal > 1 && (
                        <div className="absolute top-4 right-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                            {queuePosition}/{queueTotal}
                        </div>
                    )}

                    {/* Icon */}
                    <div className={cn("w-20 h-20 rounded-[2rem] flex items-center justify-center border", theme.bg, theme.border)}>
                        <Icon className={cn("w-10 h-10", theme.color)} />
                    </div>

                    {/* Category badge */}
                    <span className={cn("text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1.5 rounded-full", theme.badge)}>
                        {t(`budget.reminder.category.${item.category}`, item.category)}
                    </span>

                    {/* Title */}
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tight text-center">
                            {t('budget.reminder.didYouPay', 'Did you pay?')}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Expense details */}
                    <div className="w-full bg-muted/30 rounded-2xl p-4 space-y-3 border border-border/50">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground font-medium">{item.title}</span>
                            <span className={cn("text-lg font-black", theme.color)}>
                                {formatCurrency(item.amount, item.currency as any, iqdPreference as any)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3" />
                                {formatDate(item.dueDate)}
                            </div>
                            <span className={cn(
                                "font-bold",
                                isOverdue ? "text-red-500" : daysUntil <= 1 ? "text-amber-500" : "text-muted-foreground"
                            )}>
                                {isOverdue
                                    ? t('budget.reminder.overdue', 'Overdue')
                                    : daysUntil === 0
                                        ? t('budget.reminder.dueToday', 'Due Today')
                                        : daysUntil === 1
                                            ? t('budget.reminder.dueTomorrow', 'Due Tomorrow')
                                            : t('budget.reminder.dueIn', { days: daysUntil }) || `In ${daysUntil} days`
                                }
                            </span>
                        </div>
                        {item.snoozeCount > 0 && (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">
                                <BellOff className="w-3 h-3" />
                                {t('budget.reminder.snoozedTimes', { count: item.snoozeCount }) || `Snoozed ${item.snoozeCount}x`}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <DialogFooter className="w-full flex flex-col gap-3 sm:flex-col">
                        <Button
                            onClick={onPaid}
                            className={cn(
                                "w-full h-12 rounded-2xl font-black shadow-lg border-t border-white/10 transition-all active:scale-95 text-white",
                                theme.button, theme.glow
                            )}
                        >
                            {t('budget.reminder.yesPaid', 'Yes, I Paid')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={onSnooze}
                            className="w-full h-12 rounded-2xl font-black transition-all active:scale-95 gap-2"
                        >
                            <BellOff className="w-4 h-4" />
                            {t('budget.reminder.noSnooze', 'No, Remind Me Later')}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
