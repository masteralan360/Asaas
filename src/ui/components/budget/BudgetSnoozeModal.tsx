import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button
} from '@/ui/components'
import { BellOff, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { BudgetReminderItem } from '@/lib/budgetReminders'

interface BudgetSnoozeModalProps {
    isOpen: boolean
    onSnooze: (minutes: number) => void
    onDismiss: () => void
    item: BudgetReminderItem | null
    isLoading?: boolean
}

export function BudgetSnoozeModal({ isOpen, onSnooze, onDismiss, item, isLoading }: BudgetSnoozeModalProps) {
    const { t } = useTranslation()
    const [selectedMinutes, setSelectedMinutes] = useState<number>(0)

    if (!item) return null

    const dueDate = new Date(item.dueDate)
    const now = new Date()
    const msUntilDue = dueDate.getTime() - now.getTime()
    const minutesUntilDue = Math.max(0, Math.floor(msUntilDue / 60000))

    // Build dynamic options based on time until due
    const options: { label: string; value: number }[] = [
        { label: t('budget.reminder.snooze.ignore', 'Dismiss (no reminder)'), value: 0 },
        { label: t('budget.reminder.snooze.1h', '1 hour'), value: 60 },
        { label: t('budget.reminder.snooze.6h', '6 hours'), value: 360 },
        { label: t('budget.reminder.snooze.tomorrow', 'Tomorrow'), value: 1440 },
    ]

    // Add "On due date" only if due date is more than 1 day away
    if (minutesUntilDue > 1440) {
        options.push({
            label: t('budget.reminder.snooze.onDueDate', 'On due date'),
            value: minutesUntilDue
        })
    }

    const handleConfirm = () => {
        if (selectedMinutes > 0) {
            onSnooze(selectedMinutes)
        } else {
            onDismiss()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={() => { /* controlled externally */ }}>
            <DialogContent
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                className={cn(
                    "max-w-sm w-[95vw] sm:w-full p-0 overflow-hidden rounded-[2.5rem]",
                    "dark:bg-zinc-950/95 backdrop-blur-2xl shadow-2xl animate-in fade-in zoom-in duration-300",
                    "border-[3px] border-border"
                )}
            >
                <DialogHeader className="p-6 border-b bg-secondary/5 items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center mb-2">
                        <BellOff className="w-6 h-6" />
                    </div>
                    <DialogTitle>{t('budget.reminder.snoozeTitle', 'Snooze Reminder')}</DialogTitle>
                    <DialogDescription>
                        {t('budget.reminder.snoozeDesc', 'When should we remind you about this again?')}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-4 space-y-2">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            disabled={isLoading}
                            onClick={() => setSelectedMinutes(option.value)}
                            className={cn(
                                "w-full flex items-center justify-between p-4 border transition-all h-14 rounded-xl",
                                selectedMinutes === option.value
                                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium shadow-sm"
                                    : "border-border hover:border-border/80 hover:bg-secondary/20",
                                isLoading && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <span className="text-sm">{option.label}</span>
                            {selectedMinutes === option.value && <Check className="w-4 h-4 text-emerald-600" />}
                        </button>
                    ))}
                </div>

                <DialogFooter className="p-4 bg-secondary/30">
                    <Button
                        className="w-full h-12 rounded-xl font-black bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={handleConfirm}
                        disabled={isLoading}
                    >
                        {isLoading ? t('common.processing', 'Processing...') : t('common.confirm', 'Confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
