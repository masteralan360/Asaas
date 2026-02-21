import { Bell, BellOff, Receipt, Wallet, TrendingUp, Calendar, Clock, RotateCcw } from 'lucide-react'
import { Button } from '@/ui/components'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/components/dialog'


import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { BudgetReminderItem } from '@/lib/budgetReminders'

interface SnoozedBudgetItemsBellProps {
    items: BudgetReminderItem[]
    onUnsnooze: (item: BudgetReminderItem) => void
    iqdPreference: any
}


export function SnoozedBudgetItemsBell({ items, onUnsnooze, iqdPreference }: SnoozedBudgetItemsBellProps) {

    const { t } = useTranslation()

    if (items.length === 0) return null

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="relative group hover:bg-yellow-500/10 h-10 w-10">
                    <Bell className="w-5 h-5 text-yellow-500 fill-yellow-500 animate-pulse transition-transform" />
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-background">
                        {items.length}
                    </span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
                        <BellOff className="w-5 h-5" />
                        {t('budget.snoozedItems', 'Snoozed Reminders')} ({items.length})
                    </DialogTitle>
                    <p className="text-sm text-muted-foreground">
                        {t('budget.snoozedItemsDesc', 'These items are currently snoozed. Un-snooze to be reminded again.')}
                    </p>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto mt-2 space-y-3 pr-2 custom-scrollbar">
                    {items.map((item) => {
                        const styleTheme =
                            item.category === 'expense' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                                item.category === 'salary' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                                    'bg-sky-500/10 text-sky-600 border-sky-500/20'

                        const Icon =
                            item.category === 'expense' ? Receipt :
                                item.category === 'salary' ? Wallet :
                                    TrendingUp

                        const categoryLabel =
                            item.category === 'expense' ? (item.expenseCategory ? t(`budget.cat.${item.expenseCategory}`) : t('budget.expense')) :
                                item.category === 'salary' ? t('hr.salary', 'Salary') :
                                    t('budget.dividends', 'Dividends')

                        return (
                            <div key={item.id} className={cn("flex flex-col gap-3 p-4 rounded-xl border relative overflow-hidden", styleTheme)}>
                                <div className="flex items-start justify-between">
                                    <div className="flex gap-3">
                                        <div className="mt-1"><Icon className="w-5 h-5" /></div>
                                        <div>
                                            <div className="font-bold text-base leading-tight">{item.title}</div>
                                            <div className="text-sm opacity-80 mt-0.5">{categoryLabel}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-black text-base">{formatCurrency(item.amount, item.currency as any, iqdPreference)}</div>
                                        <div className="text-xs font-bold uppercase flex items-center justify-end gap-1 opacity-80 mt-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {formatDate(item.dueDate)}
                                        </div>
                                    </div>
                                </div>

                                {item.snoozeUntil && (
                                    <div className="text-sm flex items-center gap-1.5 opacity-70">
                                        <Clock className="w-4 h-4" />
                                        {t('budget.snoozedUntil', 'Snoozed until')} {formatDate(item.snoozeUntil)}
                                    </div>
                                )}

                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="w-full mt-2 bg-background/50 hover:bg-background/80"
                                    onClick={() => onUnsnooze(item)}
                                >
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    {t('budget.unsnooze', 'Un-snooze')}
                                </Button>
                            </div>
                        )
                    })}
                </div>
            </DialogContent>
        </Dialog>
    )

}
