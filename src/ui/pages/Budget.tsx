import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Calendar,
    Plus,
    CheckCircle2,
    Clock,
    ChevronLeft,
    ChevronRight,
    Trash2,
    User
} from 'lucide-react'
import { useWorkspace } from '@/workspace'
import { useExpenses, createExpense, deleteExpense, useBudgetAllocation, useMonthlyRevenue, setBudgetAllocation, useEmployees } from '@/local-db'
import { Button } from '@/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { Input } from '@/ui/components/input'
import { formatDate, formatCurrency } from '@/lib/utils'
// sonner removed
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
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

    const monthStr = useMemo(() => {
        const year = selectedMonth.getFullYear()
        const month = String(selectedMonth.getMonth() + 1).padStart(2, '0')
        return `${year}-${month}`
    }, [selectedMonth])

    const currentAllocation = useBudgetAllocation(workspaceId, monthStr)
    const monthlyFinancials = useMonthlyRevenue(workspaceId, monthStr)

    const convertToStoreBase = useCallback((amount: number, from: string) => {
        const fromCode = from.toLowerCase() as any
        if (fromCode === baseCurrency.toLowerCase()) return amount

        const usd_iqd = exchangeData?.rate || 1450
        const eur_iqd = eurRates.eur_iqd?.rate || 1600
        const try_iqd = tryRates.try_iqd?.rate || 45

        let inIQD = 0
        if (fromCode === 'usd') inIQD = amount * usd_iqd
        else if (fromCode === 'eur') inIQD = amount * eur_iqd
        else if (fromCode === 'try') inIQD = amount * try_iqd
        else inIQD = amount

        if (baseCurrency.toLowerCase() === 'usd') return inIQD / usd_iqd
        if (baseCurrency.toLowerCase() === 'eur') return inIQD / eur_iqd
        if (baseCurrency.toLowerCase() === 'try') return inIQD / try_iqd
        return inIQD
    }, [baseCurrency, exchangeData, eurRates, tryRates])

    const handlePrevMonth = () => setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    const handleNextMonth = () => setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))

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
        let personnelTotal = 0

        employees.forEach(emp => {
            // Virtual Salary
            if (emp.salary > 0) {
                const amount = emp.salary
                const currency = emp.salaryCurrency
                const baseAmount = convertToStoreBase(amount, currency)
                personnelTotal += baseAmount
                virtualExpenses.push({
                    id: `v-salary-${emp.id}`,
                    description: `${emp.name} (${t('hr.salary', 'Salary')})`,
                    amount,
                    currency,
                    category: 'payroll',
                    status: 'paid', // Virtually considered paid for metrics
                    dueDate: monthEnd.toISOString(),
                    isVirtual: true,
                    type: 'recurring'
                })
            }

            // Virtual Dividend
            if (emp.hasDividends && emp.dividendAmount && emp.dividendAmount > 0) {
                let amount = 0
                let currency = emp.dividendCurrency || 'usd'

                if (emp.dividendType === 'percentage') {
                    amount = Math.max(0, referenceProfit * (emp.dividendAmount / 100))
                    currency = baseCurrency // Percentages are calculated in base
                } else {
                    amount = emp.dividendAmount
                }

                const baseAmount = convertToStoreBase(amount, currency)
                personnelTotal += baseAmount
                virtualExpenses.push({
                    id: `v-div-${emp.id}`,
                    description: `${emp.name} (${t('hr.form.dividends', 'Dividend')})`,
                    amount,
                    currency,
                    category: 'payroll',
                    status: 'paid',
                    dueDate: monthEnd.toISOString(),
                    isVirtual: true,
                    type: 'one-time'
                })
            }
        })

        const combinedTotal = operationalTotal + personnelTotal
        const combinedPaid = operationalPaid + personnelTotal // Virtuals are paid
        const combinedPending = operationalPending

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
                amount: Number(formData.get('amount')),
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
                    <p className="text-muted-foreground">{t('budget.subtitle', 'Financial health and expense management')}</p>
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
                <Card className={`${metrics.budgetLimit > 0 ? (metrics.total > metrics.budgetLimit ? 'bg-destructive/5 border-destructive/20' : 'bg-primary/5 border-primary/20') : 'bg-primary/5 border-primary/20'}`}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('budget.totalAllocated', 'Total Allocated')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <div className="text-2xl font-bold">
                                {formatCurrency(metrics.total, baseCurrency, iqdPreference)}
                            </div>
                            {metrics.budgetLimit > 0 && (
                                <div className="text-xs text-muted-foreground">
                                    / {formatCurrency(metrics.budgetLimit, baseCurrency, iqdPreference)}
                                </div>
                            )}
                        </div>
                        {metrics.budgetLimit > 0 && (
                            <div className="w-full bg-secondary h-1.5 rounded-full mt-3 overflow-hidden">
                                <div
                                    className={`h-full transition-all ${metrics.total > metrics.budgetLimit ? 'bg-destructive' : 'bg-primary'}`}
                                    style={{ width: `${Math.min((metrics.total / metrics.budgetLimit) * 100, 100)}%` }}
                                />
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                            {metrics.count} {t('budget.items', 'items')}
                            {metrics.budgetLimit > 0 && ` • ${Math.round((metrics.total / metrics.budgetLimit) * 100)}% of budget`}
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-emerald-500/5 border-emerald-500/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('budget.paid', 'Total Paid')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">
                            {formatCurrency(metrics.paid, baseCurrency, iqdPreference)}
                        </div>
                        <div className="w-full bg-secondary h-1.5 rounded-full mt-2 overflow-hidden">
                            <div
                                className="bg-emerald-500 h-full transition-all"
                                style={{ width: `${(metrics.paid / (metrics.total || 1)) * 100}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('budget.pending', 'Outstanding')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">
                            {formatCurrency(metrics.pending, baseCurrency, iqdPreference)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Due by end of month</p>
                    </CardContent>
                </Card>
                <Card className="bg-blue-500/5 border-blue-500/20 shadow-lg">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground text-blue-600">Alpha Preview</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-[10px] text-muted-foreground mt-1 italic">V1: Sales auto-sync coming soon</p>
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
                        className={`flex items-center justify-between p-4 rounded-xl border transition-shadow group ${expense.isVirtual
                            ? 'bg-blue-500/5 border-blue-500/20 hover:shadow-blue-500/10'
                            : 'bg-card border-border hover:shadow-md'
                            }`}
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
                                <div className={`font-bold ${expense.isVirtual ? 'text-blue-600' : ''}`}>
                                    {formatCurrency(expense.amount, expense.currency, iqdPreference)}
                                </div>
                                <div className={`text-[10px] font-bold uppercase tracking-wider ${expense.isVirtual ? 'text-blue-500' :
                                    expense.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'
                                    }`}>
                                    {expense.isVirtual ? t('hr.personnel', 'Personnel') : t(`budget.status.${expense.status}`)}
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('budget.addExpense', 'Create New Expense')}</DialogTitle>
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
                                    <Input id="amount" name="amount" type="number" className="flex-1" required />
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
                </DialogContent>
            </Dialog>

            <Dialog open={isAllocationDialogOpen} onOpenChange={setIsAllocationDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('budget.setBudgetTitle', 'Monthly Budget Allocation')}</DialogTitle>
                    </DialogHeader>
                    <form
                        onSubmit={async (e) => {
                            e.preventDefault()
                            const formData = new FormData(e.currentTarget)
                            if (!workspaceId) return
                            try {
                                await setBudgetAllocation(workspaceId, {
                                    month: monthStr,
                                    type: formData.get('type') as any,
                                    amount: Number(formData.get('amount')),
                                    currency: (formData.get('currency') as any) || 'usd'
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
                            <Select name="type" defaultValue={currentAllocation?.type || 'fixed'}>
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
                                <Input
                                    name="amount"
                                    type="number"
                                    step="0.01"
                                    defaultValue={currentAllocation?.amount || 0}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('budget.payroll.currency', 'Currency')}</Label>
                                <Select name="currency" defaultValue={currentAllocation?.currency || baseCurrency || 'usd'}>
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
                                {formatCurrency(metrics.budgetLimit, baseCurrency, iqdPreference)}
                            </p>
                            {currentAllocation?.type === 'percentage' && (
                                <p className="text-[10px] text-muted-foreground">
                                    Based on {monthStr} revenue
                                </p>
                            )}
                        </div>

                        <DialogFooter className="pt-4">
                            <Button type="submit" className="w-full">{t('common.save', 'Save Allocation')}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

