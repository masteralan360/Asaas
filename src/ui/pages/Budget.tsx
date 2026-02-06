import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Calendar,
    Plus,
    CheckCircle2,
    Clock,
    ChevronLeft,
    ChevronRight,
    Trash2,
    TrendingUp,
    BarChart3,
    ArrowRight,
    User
} from 'lucide-react'
import { useWorkspace } from '@/workspace'
import { useExpenses, createExpense, deleteExpense, useBudgetAllocation, useMonthlyRevenue, setBudgetAllocation, useEmployees } from '@/local-db'
import { Button } from '@/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { Input } from '@/ui/components/input'
import { CurrencyCode } from '@/local-db'
import { formatCurrency, formatDate, formatNumberWithCommas, parseFormattedNumber, cn } from '@/lib/utils'
// sonner removed
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    useToast
} from '@/ui/components'
import { Label } from '@/ui/components/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components/select'

import { useExchangeRate } from '@/context/ExchangeRateContext'
import { useCallback } from 'react'

export default function Budget() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { activeWorkspace, features } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const workspaceId = activeWorkspace?.id
    const baseCurrency = (features.default_currency || 'usd') as any
    const iqdPreference = features.iqd_display_preference
    const expenses = useExpenses(workspaceId)
    const employees = useEmployees(workspaceId)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [isAllocationDialogOpen, setIsAllocationDialogOpen] = useState(false)
    const [selectedMonth, setSelectedMonth] = useState(new Date())
    const [allocAmountDisplay, setAllocAmountDisplay] = useState<string>('')
    const [allocType, setAllocType] = useState<'fixed' | 'percentage'>('fixed')
    const [allocCurrency, setAllocCurrency] = useState<CurrencyCode>(baseCurrency as any || 'usd')

    const monthStr = useMemo(() => {
        const year = selectedMonth.getFullYear()
        const month = String(selectedMonth.getMonth() + 1).padStart(2, '0')
        return `${year}-${month}`
    }, [selectedMonth])

    const currentAllocation = useBudgetAllocation(workspaceId, monthStr)
    const monthlyFinancials = useMonthlyRevenue(workspaceId, monthStr)

    // Init allocation modal states
    useEffect(() => {
        if (isAllocationDialogOpen) {
            setAllocType(currentAllocation?.type || 'fixed')
            setAllocAmountDisplay(formatNumberWithCommas(currentAllocation?.amount || 0))
            setAllocCurrency(currentAllocation?.currency || baseCurrency as any || 'usd')
        } else if (isDialogOpen === false) {
            setExpenseAmountDisplay('')
        }
    }, [isAllocationDialogOpen, isDialogOpen, currentAllocation, baseCurrency])

    const convertToStoreBase = useCallback((amount: number | undefined | null, from: string | undefined | null) => {
        if (!amount || isNaN(Number(amount))) return 0
        if (!from) return amount

        const fromCode = from.toLowerCase() as any
        const baseCode = baseCurrency.toLowerCase()
        if (fromCode === baseCode) return amount

        const usd_iqd = exchangeData?.rate || 1450
        const eur_iqd = eurRates.eur_iqd?.rate || 1600
        const try_iqd = tryRates.try_iqd?.rate || 45

        let inIQD = 0
        if (fromCode === 'usd') inIQD = amount * usd_iqd
        else if (fromCode === 'eur') inIQD = amount * eur_iqd
        else if (fromCode === 'try') inIQD = amount * try_iqd
        else inIQD = amount

        if (baseCode === 'usd') return inIQD / usd_iqd
        if (baseCode === 'eur') return inIQD / eur_iqd
        if (baseCode === 'try') return inIQD / try_iqd
        return inIQD
    }, [baseCurrency, exchangeData, eurRates, tryRates])

    const handlePrevMonth = () => setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    const handleNextMonth = () => setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))

    const [expenseAmountDisplay, setExpenseAmountDisplay] = useState<string>('')

    const metrics = useMemo(() => {
        const year = selectedMonth.getFullYear()
        const month = selectedMonth.getMonth()
        const monthStart = new Date(year, month, 1)
        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59)

        const monthExpenses = expenses.filter(e => {
            const date = new Date(e.dueDate)
            return date >= monthStart && date <= monthEnd && !e.isDeleted
        }).map(e => ({ ...e, isVirtual: false }))

        const operationalTotal = monthExpenses.reduce((sum, e) => sum + convertToStoreBase(e.amount, e.currency), 0)
        const operationalPaid = monthExpenses.filter(e => e.status === 'paid').reduce((sum, e) => sum + convertToStoreBase(e.amount, e.currency), 0)
        const operationalPending = monthExpenses.filter(e => e.status === 'pending').reduce((sum, e) => sum + convertToStoreBase(e.amount, e.currency), 0)

        const totalProfitFromRevenue = Object.entries(monthlyFinancials.profit || {}).reduce((sum, [curr, amt]) => sum + convertToStoreBase(amt, curr), 0)

        // The user wants Dividends and Budget % to calculate from the "Net Profit" of the Revenue page (Revenue - COGS)
        // Note: Operational Expenses are handled separately in the budget metrics, so we stick to the Revenue Page's definition
        const referenceProfit = totalProfitFromRevenue

        // Add virtual personnel costs
        const virtualExpenses: any[] = []
        let personnelPaid = 0
        let personnelPending = 0
        const today = new Date()

        employees.forEach(emp => {
            // Virtual Salary
            if (emp.salary > 0) {
                const amount = emp.isFired ? 0 : emp.salary
                const originalAmount = emp.salary
                const currency = emp.salaryCurrency

                // Determine payday date
                const pDay = Number(emp.salaryPayday) || 30
                let payDate = new Date(year, month, Math.min(pDay, new Date(year, month + 1, 0).getDate()))
                if (isNaN(payDate.getTime())) payDate = monthEnd

                const status = today >= payDate ? 'paid' : 'pending'
                const baseAmount = convertToStoreBase(amount, currency)

                if (status === 'paid') personnelPaid += baseAmount
                else personnelPending += baseAmount

                virtualExpenses.push({
                    id: `v-salary-${emp.id}`,
                    description: `${emp.name} (${t('hr.salary', 'Salary')})`,
                    amount,
                    originalAmount,
                    currency,
                    category: 'payroll',
                    status,
                    dueDate: payDate.toISOString(),
                    isVirtual: true,
                    isFired: emp.isFired,
                    type: 'recurring'
                })
            }

            // Virtual Dividend
            if (emp.hasDividends && emp.dividendAmount && emp.dividendAmount > 0) {
                let amount = 0
                let originalAmount = 0
                let currency = (emp.dividendCurrency as any) || 'usd'

                if (emp.dividendType === 'percentage') {
                    originalAmount = Math.max(0, referenceProfit * (emp.dividendAmount / 100))
                    amount = emp.isFired ? 0 : originalAmount
                    currency = baseCurrency // Percentages are calculated in base
                } else {
                    originalAmount = emp.dividendAmount
                    amount = emp.isFired ? 0 : originalAmount
                }

                // Determine payday date
                const pDay = Number(emp.dividendPayday) || 30
                let payDate = new Date(year, month, Math.min(pDay, new Date(year, month + 1, 0).getDate()))
                if (isNaN(payDate.getTime())) payDate = monthEnd

                const status = today >= payDate ? 'paid' : 'pending'
                const baseAmount = convertToStoreBase(amount, currency)

                if (status === 'paid') personnelPaid += baseAmount
                else personnelPending += baseAmount

                virtualExpenses.push({
                    id: `v-div-${emp.id}`,
                    description: `${emp.name} (${t('hr.form.dividends', 'Dividend')})`,
                    amount,
                    originalAmount,
                    currency,
                    category: 'payroll',
                    status,
                    dueDate: payDate.toISOString(),
                    isVirtual: true,
                    isFired: emp.isFired,
                    type: 'recurring'
                })
            }
        })

        const combinedTotal = operationalTotal + personnelPaid + personnelPending
        const combinedPaid = operationalPaid + personnelPaid
        const combinedPending = operationalPending + personnelPending

        const hasMixedCurrencies = new Set([...monthExpenses, ...virtualExpenses].map(e => e.currency?.toLowerCase())).size > 1

        let budgetLimit = 0
        if (currentAllocation) {
            if (currentAllocation.type === 'fixed') {
                budgetLimit = convertToStoreBase(currentAllocation.amount, currentAllocation.currency)
            } else {
                budgetLimit = referenceProfit * (currentAllocation.amount / 100)
            }
        }

        return {
            total: combinedTotal,
            paid: combinedPaid,
            pending: combinedPending,
            count: monthExpenses.length + virtualExpenses.length,
            isMixed: hasMixedCurrencies,
            budgetLimit,
            referenceProfit,
            displayExpenses: [...monthExpenses, ...virtualExpenses]
        }
    }, [expenses, employees, selectedMonth, convertToStoreBase, currentAllocation, monthlyFinancials, t, baseCurrency])

    const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!workspaceId) return

        const formData = new FormData(e.currentTarget)
        try {
            await createExpense(workspaceId, {
                description: formData.get('description') as string,
                type: formData.get('type') as any,
                category: formData.get('category') as any,
                amount: parseFormattedNumber(expenseAmountDisplay),
                currency: (formData.get('currency') as any) || baseCurrency || 'usd',
                status: 'pending',
                dueDate: formData.get('dueDate') as string,
                paidAt: null,
                snoozeUntil: null,
                snoozeCount: 0
            })
            toast({ description: t('budget.expenseAdded', 'Expense added to tracker') })
            setIsDialogOpen(false)
        } catch (error) {
            toast({ variant: 'destructive', description: t('common.error', 'Failed to add expense') })
        }
    }

    const isCurrentMonth = selectedMonth.getFullYear() === new Date().getFullYear() &&
        selectedMonth.getMonth() === new Date().getMonth()

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('nav.budget', 'Budget')}</h1>
                    <p className="text-muted-foreground">
                        {t('budget.subtitle', 'Financial health and expense management')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handlePrevMonth}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <div className="px-4 py-2 bg-secondary rounded-md font-bold text-sm">
                        {selectedMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </div>
                    <Button variant="outline" onClick={handleNextMonth}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" onClick={() => setSelectedMonth(new Date())} disabled={isCurrentMonth}>
                        {t('common.current', 'Now')}
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Total Allocated */}
                <Card
                    className={cn(
                        "cursor-pointer hover:scale-[1.02] transition-all hover:bg-opacity-10 dark:hover:bg-opacity-20 active:scale-95 group relative overflow-hidden rounded-[2rem]",
                        metrics.budgetLimit > 0
                            ? (metrics.total > metrics.budgetLimit
                                ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 hover:shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)]'
                                : 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]')
                            : 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]'
                    )}
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className={cn("w-4 h-4", metrics.total > metrics.budgetLimit ? "text-red-500" : "text-blue-500")} />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className={cn(
                            "text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2",
                            metrics.total > metrics.budgetLimit ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"
                        )}>
                            <BarChart3 className="w-4 h-4" />
                            {t('budget.totalAllocated', 'Total Allocated')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <div className={cn(
                                "text-2xl font-black tracking-tighter tabular-nums",
                                metrics.total > metrics.budgetLimit ? "text-red-700 dark:text-red-300" : "text-blue-700 dark:text-blue-300"
                            )}>
                                {formatCurrency(metrics.total, baseCurrency, iqdPreference)}
                            </div>
                            {metrics.budgetLimit > 0 && (
                                <div className="text-xs font-bold opacity-60">
                                    / {formatCurrency(metrics.budgetLimit, baseCurrency, iqdPreference)}
                                </div>
                            )}
                        </div>
                        {metrics.budgetLimit > 0 && (
                            <div className="w-full bg-black/5 dark:bg-white/5 h-2 rounded-full mt-3 overflow-hidden border border-black/5 dark:border-white/5">
                                <div
                                    className={cn("h-full transition-all duration-1000", metrics.total > metrics.budgetLimit ? 'bg-red-500' : 'bg-blue-500')}
                                    style={{ width: `${Math.min((metrics.total / metrics.budgetLimit) * 100, 100)}%` }}
                                />
                            </div>
                        )}
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-2 opacity-60">
                            {metrics.count} {t('budget.items', 'items')}
                            {metrics.budgetLimit > 0 && ` • ${Math.round((metrics.total / metrics.budgetLimit) * 100)}% of budget`}
                        </p>
                    </CardContent>
                </Card>

                {/* Total Paid */}
                <Card
                    className="bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-emerald-500/10 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] active:scale-95 group relative overflow-hidden rounded-[2rem]"
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="w-4 h-4 text-emerald-500" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-2 uppercase tracking-[0.2em]">
                            <CheckCircle2 className="w-4 h-4" />
                            {t('budget.paid', 'Total Paid')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black tracking-tighter tabular-nums text-emerald-700 dark:text-emerald-300">
                            {formatCurrency(metrics.paid, baseCurrency, iqdPreference)}
                        </div>
                        <div className="w-full bg-black/5 dark:bg-white/5 h-2 rounded-full mt-3 overflow-hidden border border-black/5 dark:border-white/5">
                            <div
                                className="bg-emerald-500 h-full transition-all duration-1000"
                                style={{ width: `${(metrics.paid / (metrics.total || 1)) * 100}%` }}
                            />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-2 opacity-60">
                            {((metrics.paid / (metrics.total || 1)) * 100).toFixed(1)}% {t('budget.status.paid', 'Paid')}
                        </p>
                    </CardContent>
                </Card>

                {/* Outstanding */}
                <Card
                    className="bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-amber-500/10 hover:shadow-[0_0_20px_-5px_rgba(245,158,11,0.3)] active:scale-95 group relative overflow-hidden rounded-[2rem]"
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="w-4 h-4 text-amber-500" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-black text-amber-600 dark:text-amber-400 flex items-center gap-2 uppercase tracking-[0.2em]">
                            <Clock className="w-4 h-4" />
                            {t('budget.pending', 'Outstanding')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black tracking-tighter tabular-nums text-amber-700 dark:text-amber-300">
                            {formatCurrency(metrics.pending, baseCurrency, iqdPreference)}
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-2 opacity-60">
                            {t('budget.dueByEnd', 'Due by end of month')}
                        </p>
                    </CardContent>
                </Card>

                {/* Alpha Preview */}
                <Card
                    className="bg-violet-500/5 dark:bg-violet-500/10 border-violet-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-violet-500/10 hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)] active:scale-95 group relative overflow-hidden rounded-[2rem]"
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <TrendingUp className="w-4 h-4 text-violet-500" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-black text-violet-600 dark:text-violet-400 flex items-center gap-2 uppercase tracking-[0.2em]">
                            <TrendingUp className="w-4 h-4" />
                            Alpha Preview
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs font-bold text-violet-600/60 dark:text-violet-400/60 leading-tight">
                            V1: Sales auto-sync coming soon
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 opacity-60">
                            Track automated deductions
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="flex items-center justify-between pt-4">
                <h2 className="text-lg font-semibold">{t('budget.expenseList', 'Monthly Expenses')}</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsAllocationDialogOpen(true)} className="gap-2">
                        <Calendar className="w-4 h-4" />
                        {t('budget.setBudget', 'Set Budget')}
                    </Button>
                    <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
                        <Plus className="w-4 h-4" />
                        {t('budget.addExpense', 'New Expense')}
                    </Button>
                </div>
            </div>

            <div className="grid gap-4">
                {metrics.displayExpenses.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()).map((expense) => (
                    <div
                        key={expense.id}
                        className={cn(
                            "flex items-center justify-between p-4 rounded-xl border transition-shadow group",
                            expense.isVirtual
                                ? 'bg-blue-500/5 border-blue-500/20 hover:shadow-blue-500/10'
                                : 'bg-card border-border hover:shadow-md',
                            (expense as any).isFired && "opacity-40 grayscale brightness-75 bg-muted/20"
                        )}
                    >
                        <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-lg ${expense.isVirtual ? 'bg-blue-500/10 text-blue-500' :
                                expense.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                                }`}>
                                {expense.isVirtual ? <User className="w-5 h-5" /> :
                                    expense.status === 'paid' ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                            </div>
                            <div>
                                <div className="font-semibold">{expense.description || t(`budget.cat.${expense.category}`)}</div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                    <span className="capitalize">{expense.category}</span>
                                    <span>•</span>
                                    <Calendar className="w-3 h-3" />
                                    {formatDate(expense.dueDate)}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="text-end">
                                <div className={cn(
                                    "font-bold",
                                    expense.isVirtual && !(expense as any).isFired && 'text-blue-600',
                                    (expense as any).isFired && 'text-muted-foreground'
                                )}>
                                    {(expense as any).isFired ? (
                                        <div className="flex flex-col items-end">
                                            <span className="text-[10px] line-through opacity-50">
                                                {formatCurrency((expense as any).originalAmount || 0, expense.currency, iqdPreference)}
                                            </span>
                                            <span>{formatCurrency(0, expense.currency, iqdPreference)}</span>
                                        </div>
                                    ) : (
                                        formatCurrency(expense.amount, expense.currency, iqdPreference)
                                    )}
                                </div>
                                <div className={cn(
                                    "text-[10px] font-bold uppercase tracking-wider",
                                    (expense as any).isFired ? 'text-muted-foreground' : (
                                        expense.isVirtual ? 'text-blue-500' :
                                            expense.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'
                                    )
                                )}>
                                    {(expense as any).isFired ? t('hr.personnel_fired', 'Staff (Fired/Suspended)') : (
                                        expense.isVirtual ? t('hr.personnel', 'Personnel') : t(`budget.status.${expense.status}`)
                                    )}
                                </div>
                            </div>
                            {!expense.isVirtual && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                                    onClick={() => deleteExpense(expense.id)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className={cn(
                    "max-w-md w-[95vw] sm:w-full p-0 bg-background/95 backdrop-blur-3xl overflow-hidden rounded-[2.5rem] shadow-2xl transition-all duration-500",
                    "border-[3px] border-emerald-500/50 shadow-emerald-500/10"
                )}>
                    <div className="p-6 md:p-8 space-y-6">
                        <DialogHeader className="flex flex-row items-center gap-4 space-y-0">
                            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                <Plus className="w-6 h-6" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-black tracking-tight">{t('budget.addExpense', 'Create New Expense')}</DialogTitle>
                                <DialogDescription className="text-xs font-semibold text-muted-foreground/80 lowercase">
                                    {t('budget.addExpenseSubtitle', 'Add a manual cost to your monthly tracks')}
                                </DialogDescription>
                            </div>
                        </DialogHeader>
                        <form onSubmit={handleAddExpense} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <Label htmlFor="description">{t('budget.form.desc', 'Description')}</Label>
                                <Input id="description" name="description" placeholder="e.g. Monthly Rent" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="amount">{t('budget.form.amount', 'Amount')}</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="amount"
                                            name="amount"
                                            value={expenseAmountDisplay}
                                            onChange={(e) => setExpenseAmountDisplay(formatNumberWithCommas(e.target.value))}
                                            placeholder="0"
                                            className="flex-1"
                                            required
                                        />
                                        <Select name="currency" defaultValue={baseCurrency || 'usd'}>
                                            <SelectTrigger className="w-[80px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="usd">USD</SelectItem>
                                                <SelectItem value="iqd">IQD</SelectItem>
                                                <SelectItem value="eur">EUR</SelectItem>
                                                <SelectItem value="try">TRY</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="category">{t('budget.form.category', 'Category')}</Label>
                                    <Select name="category" defaultValue="utility">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="payroll">{t('budget.cat.payroll', 'Payroll')}</SelectItem>
                                            <SelectItem value="rent">{t('budget.cat.rent', 'Rent')}</SelectItem>
                                            <SelectItem value="utility">{t('budget.cat.utility', 'Utilities')}</SelectItem>
                                            <SelectItem value="marketing">{t('budget.cat.marketing', 'Marketing')}</SelectItem>
                                            <SelectItem value="other">{t('budget.cat.other', 'Other')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="type">{t('budget.form.type', 'Type')}</Label>
                                    <Select name="type" defaultValue="recurring">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="recurring">{t('budget.type.recurring', 'Recurring')}</SelectItem>
                                            <SelectItem value="one-time">{t('budget.type.one-time', 'One-time')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="dueDate">{t('budget.form.dueDate', 'Due Date')}</Label>
                                    <Input id="dueDate" name="dueDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
                                </div>
                            </div>
                            <DialogFooter className="pt-4">
                                <Button type="submit" className="w-full">{t('common.save', 'Create Expense')}</Button>
                            </DialogFooter>
                        </form>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isAllocationDialogOpen} onOpenChange={setIsAllocationDialogOpen}>
                <DialogContent className={cn(
                    "max-w-md w-[95vw] sm:w-full p-0 bg-background/95 backdrop-blur-3xl overflow-hidden rounded-[2.5rem] shadow-2xl transition-all duration-500",
                    "border-[3px] border-amber-500/50 shadow-amber-500/10"
                )}>
                    <div className="p-6 md:p-8 space-y-6">
                        <DialogHeader className="flex flex-row items-center gap-4 space-y-0">
                            <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <TrendingUp className="w-6 h-6" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-black tracking-tight">{t('budget.setBudgetTitle', 'Monthly Budget Allocation')}</DialogTitle>
                                <DialogDescription className="text-xs font-semibold text-muted-foreground/80 lowercase">
                                    {t('budget.setBudgetSubtitle', 'Define your spending limits for this month')}
                                </DialogDescription>
                            </div>
                        </DialogHeader>
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault()
                                if (!workspaceId) return
                                try {
                                    await setBudgetAllocation(workspaceId, {
                                        month: monthStr,
                                        type: allocType,
                                        amount: parseFormattedNumber(allocAmountDisplay),
                                        currency: allocCurrency
                                    })
                                    toast({ description: t('budget.allocationSaved', 'Budget allocation updated') })
                                    setIsAllocationDialogOpen(false)
                                } catch (error) {
                                    toast({ variant: 'destructive', description: t('common.error', 'Failed to save budget') })
                                }
                            }}
                            className="space-y-4 pt-4"
                        >
                            <div className="space-y-2">
                                <Label>{t('budget.form.type', 'Allocation Type')}</Label>
                                <Select value={allocType} onValueChange={(val: any) => {
                                    setAllocType(val)
                                    if (val === 'percentage') {
                                        const numeric = parseFormattedNumber(allocAmountDisplay)
                                        if (numeric > 100) setAllocAmountDisplay("100")
                                    }
                                }}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="fixed">{t('budget.type.fixed', 'Fixed Amount')}</SelectItem>
                                        <SelectItem value="percentage">{t('budget.type.percentage', 'Percentage of Revenue')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>{t('budget.form.amount', 'Amount / %')}</Label>
                                    <div className="relative">
                                        <Input
                                            value={allocAmountDisplay}
                                            onChange={(e) => {
                                                let val = e.target.value;
                                                if (allocType === 'percentage') {
                                                    const numeric = parseFormattedNumber(val);
                                                    if (numeric > 100) val = "100";
                                                }
                                                setAllocAmountDisplay(formatNumberWithCommas(val));
                                            }}
                                            placeholder="0"
                                            className={cn(allocType === 'percentage' && "pr-8")}
                                            required
                                        />
                                        {allocType === 'percentage' && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-black pointer-events-none">
                                                %
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('budget.payroll.currency', 'Currency')}</Label>
                                    <Select value={allocCurrency} onValueChange={(val: any) => setAllocCurrency(val)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="usd">USD</SelectItem>
                                            <SelectItem value="iqd">IQD</SelectItem>
                                            <SelectItem value="eur">EUR</SelectItem>
                                            <SelectItem value="try">TRY</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="p-4 bg-secondary/50 rounded-xl space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-widest opacity-60">Estimated Limit</h4>
                                <p className="text-lg font-bold">
                                    {formatCurrency(
                                        allocType === 'fixed'
                                            ? convertToStoreBase(parseFormattedNumber(allocAmountDisplay), allocCurrency)
                                            : metrics.referenceProfit * (parseFormattedNumber(allocAmountDisplay) / 100),
                                        baseCurrency,
                                        iqdPreference
                                    )}
                                </p>
                                {allocType === 'percentage' && (
                                    <p className="text-[10px] text-muted-foreground">
                                        Based on {monthStr} revenue
                                    </p>
                                )}
                            </div>

                            <DialogFooter className="pt-4">
                                <Button type="submit" className="w-full">{t('common.save', 'Save Allocation')}</Button>
                            </DialogFooter>
                        </form>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    )
}

