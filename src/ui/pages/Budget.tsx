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
    User,
    AlertTriangle,
    Repeat,
    Circle
} from 'lucide-react'
import { useWorkspace } from '@/workspace'
import { useExpenses, createExpense, deleteExpense, updateExpense, useBudgetAllocation, useMonthlyRevenue, setBudgetAllocation, useEmployees, useWorkspaceUsers } from '@/local-db'
import { platformService } from '@/services/platformService'
import { Button } from '@/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { Input } from '@/ui/components/input'
import { CurrencyCode } from '@/local-db'
import { formatCurrency, formatDate, formatNumberWithCommas, parseFormattedNumber, cn } from '@/lib/utils'
import { convertToStoreBase as convertToStoreBaseUtil } from '@/lib/currency'
// sonner removed
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    useToast,
    DividendDistributionModal
} from '@/ui/components'
import type { DividendRecipient } from '@/ui/components/DividendModal'
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
    const [isDividendModalOpen, setIsDividendModalOpen] = useState(false)
    const workspaceUsers = useWorkspaceUsers(workspaceId)

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
        return convertToStoreBaseUtil(amount, from, baseCurrency, {
            usd_iqd: (exchangeData?.rate || 145000) / 100,
            eur_iqd: (eurRates.eur_iqd?.rate || 160000) / 100,
            try_iqd: (tryRates.try_iqd?.rate || 4500) / 100
        })
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
            // One-time expenses ONLY in their month
            if (e.type === 'one-time') {
                return date >= monthStart && date <= monthEnd && !e.isDeleted
            }
            return false
        }).map(e => ({ ...e, isVirtual: false, isRecurringVirtual: false }))

        // Process Recurring Templates
        const recurringTemplates = expenses.filter(e => e.type === 'recurring' && !e.isDeleted)
        const virtualRecurringExpenses: any[] = []

        recurringTemplates.forEach(template => {
            // Project to current month
            const templateDate = new Date(template.dueDate)
            const projectedDate = new Date(year, month, Math.min(templateDate.getDate(), new Date(year, month + 1, 0).getDate()))

            // Check if already paid (exists as one-time in this month with same description)
            // We match by Description + Amount to be safe, or just Description
            const isPaid = monthExpenses.some(e =>
                e.description?.trim().toLowerCase() === template.description?.trim().toLowerCase()
            )

            if (!isPaid) {
                virtualRecurringExpenses.push({
                    ...template,
                    id: `v-recurring-${template.id}-${month}`, // Unique ID for key
                    originalTemplateId: template.id,
                    dueDate: projectedDate.toISOString(),
                    status: 'pending',
                    isVirtual: true,
                    isRecurringVirtual: true
                })
            }
        })

        // Combine for totals
        const operationalExpenses = [...monthExpenses, ...virtualRecurringExpenses]

        let operationalTotal = 0
        let operationalPaid = 0
        let operationalPending = 0

        operationalExpenses.forEach(exp => {
            const baseAmount = convertToStoreBase(exp.amount, exp.currency)
            operationalTotal += baseAmount
            if (exp.status === 'paid') operationalPaid += baseAmount
            else operationalPending += baseAmount
        })

        const totalProfitFromRevenue = Object.entries(monthlyFinancials.profit || {}).reduce((sum, [curr, amt]) => sum + convertToStoreBase(amt, curr), 0)

        const virtualExpenses: any[] = []
        let personnelPaid = 0
        let personnelPending = 0
        const today = new Date()

        // Pass 1: Personnel Salaries (Base ONLY)
        employees.forEach(emp => {
            // Salary
            if (emp.salary && emp.salary > 0) {
                const amount = emp.salary
                const currency = (emp.salaryCurrency as any) || 'usd'
                const pDay = Number(emp.salaryPayday) || 30
                let payDate = new Date(year, month, Math.min(pDay, new Date(year, month + 1, 0).getDate()))
                const status = today >= payDate ? 'paid' : 'pending'
                const baseAmount = convertToStoreBase(amount, currency)

                if (status === 'paid') personnelPaid += baseAmount
                else personnelPending += baseAmount

                virtualExpenses.push({
                    id: `v-salary-${emp.id}`,
                    description: `${emp.name} (${t('hr.salary', 'Salary')})`,
                    amount,
                    currency,
                    category: 'payroll',
                    status,
                    dueDate: payDate.toISOString(),
                    isVirtual: true,
                    type: 'recurring'
                })
            }
        })

        const totalOperational = operationalTotal + personnelPaid + personnelPending
        const referenceProfit = totalProfitFromRevenue

        // Pass 2: Profit Pool (Money after hard bills)
        const profitPool = Math.max(0, referenceProfit - totalOperational)

        // Pass 3: Dividends (Distribution from Profit Pool)
        let dividendTotal = 0
        let dividendPaid = 0
        let dividendPending = 0

        const dividendRecipients: DividendRecipient[] = []

        employees.forEach(emp => {
            if (emp.hasDividends && emp.dividendAmount && emp.dividendAmount > 0) {
                let amount = 0
                if (emp.dividendType === 'fixed') {
                    amount = emp.dividendAmount
                } else {
                    amount = profitPool * (emp.dividendAmount / 100)
                }

                const finalAmount = emp.isFired ? 0 : amount
                const currency = emp.dividendType === 'fixed' ? (emp.dividendCurrency as any || 'usd') : baseCurrency
                const pDay = Number(emp.dividendPayday) || 30
                let payDate = new Date(year, month, Math.min(pDay, new Date(year, month + 1, 0).getDate()))
                const status = today >= payDate ? 'paid' : 'pending'
                const baseAmount = convertToStoreBase(finalAmount, currency)

                dividendTotal += baseAmount
                if (status === 'paid') dividendPaid += baseAmount
                else dividendPending += baseAmount

                const linkedUser = emp.linkedUserId ? workspaceUsers.find(u => u.id === emp.linkedUserId) : null
                const avatarUrl = linkedUser?.profileUrl ? platformService.convertFileSrc(linkedUser.profileUrl) : undefined

                dividendRecipients.push({
                    name: emp.name,
                    amount: finalAmount,
                    currency,
                    formula: emp.dividendType === 'fixed' ? formatCurrency(emp.dividendAmount, currency as any, iqdPreference) : `${emp.dividendAmount}%`,
                    isLinked: !!emp.linkedUserId,
                    isFired: emp.isFired,
                    avatarUrl
                })

                // Dividends are NOT pushed to virtualExpenses anymore to exclude them from the main list
            }
        })

        const EPSILON = 0.01 // Ignore tiny floating point differences
        const roundedProfitPool = Math.round(profitPool * 100) / 100
        const roundedDividendTotal = Math.round(dividendTotal * 100) / 100
        const finalNetProfitValue = roundedProfitPool - roundedDividendTotal
        const isDeficit = finalNetProfitValue < -EPSILON
        const cleanNetProfit = Math.abs(finalNetProfitValue) < EPSILON ? 0 : finalNetProfitValue

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
            operationalTotal: totalOperational,
            total: totalOperational,
            paid: operationalPaid + personnelPaid,
            pending: operationalPending + personnelPending,
            dividendTotal: roundedDividendTotal,
            dividendPaid,
            dividendPending,
            finalNetProfit: cleanNetProfit,
            profitPool: roundedProfitPool,
            isDeficit,
            count: monthExpenses.length + virtualExpenses.length,
            isMixed: hasMixedCurrencies,
            budgetLimit,
            referenceProfit,
            displayExpenses: [...monthExpenses, ...virtualRecurringExpenses, ...virtualExpenses],
            dividendRecipients
        }
    }, [expenses, employees, workspaceUsers, selectedMonth, convertToStoreBase, currentAllocation, monthlyFinancials, t, baseCurrency, iqdPreference])

    const [isSaving, setIsSaving] = useState(false)

    const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!workspaceId || isSaving) return

        const formData = new FormData(e.currentTarget)
        setIsSaving(true)
        // Optimistically close for better UX
        setIsDialogOpen(false)

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
        } catch (error) {
            toast({ variant: 'destructive', description: t('common.error', 'Failed to add expense') })
            setIsDialogOpen(true) // Re-open on error
        } finally {
            setIsSaving(false)
        }
    }

    const handleToggleStatus = async (expense: any) => {
        if (!workspaceId) return

        try {
            if (expense.isRecurringVirtual) {
                // Determine due date from the virtual expense
                // expense.dueDate is already projected to the correct month in metrics
                await createExpense(workspaceId, {
                    description: expense.description,
                    type: 'one-time',
                    category: expense.category,
                    amount: expense.amount,
                    currency: expense.currency,
                    status: 'paid',
                    dueDate: expense.dueDate,
                    paidAt: new Date().toISOString(),
                    snoozeUntil: null,
                    snoozeCount: 0
                })
                toast({ description: t('budget.expensePaid', 'Expense marked as paid') })
            } else if (!expense.isVirtual || (expense.isVirtual && !expense.isRecurringVirtual)) {
                // Real expense (one-time)
                // Toggle status
                const newStatus = expense.status === 'paid' ? 'pending' : 'paid'
                await updateExpense(expense.id, {
                    status: newStatus,
                    paidAt: newStatus === 'paid' ? new Date().toISOString() : null
                })
                toast({ description: t('budget.statusUpdated', 'Status updated') })
            }
        } catch (error) {
            console.error(error)
            toast({ variant: 'destructive', description: t('common.error', 'Failed to update status') })
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

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {/* Total Allocated (Operational) */}
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
                            {metrics.budgetLimit > 0 && ` • ${Math.round((metrics.total / metrics.budgetLimit) * 100)}% ${t('budget.limit', 'of budget')}`}
                            {metrics.referenceProfit > 0 && (
                                <> • {Math.round((metrics.dividendTotal / metrics.referenceProfit) * 100)}% {t('budget.dividends', 'Dividends')}</>
                            )}
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

                {/* Dividends Total */}
                <Card
                    className={cn(
                        "cursor-pointer hover:scale-[1.02] transition-all active:scale-95 group relative overflow-hidden rounded-[2rem]",
                        metrics.isDeficit
                            ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 hover:bg-red-500/10 hover:shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)]'
                            : 'bg-sky-500/5 dark:bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/10 hover:shadow-[0_0_20px_-5px_rgba(14,165,233,0.3)]'
                    )}
                    onClick={() => setIsDividendModalOpen(true)}
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <User className="w-4 h-4 text-sky-500" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className={cn(
                            "text-xs font-black flex items-center gap-2 uppercase tracking-[0.2em]",
                            metrics.isDeficit ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400'
                        )}>
                            <User className="w-4 h-4" />
                            {t('budget.dividends', 'Dividends Total')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={cn(
                            "text-2xl font-black tracking-tighter tabular-nums",
                            metrics.isDeficit ? 'text-red-700 dark:text-red-300' : 'text-sky-700 dark:text-sky-300'
                        )}>
                            {formatCurrency(metrics.dividendTotal, baseCurrency, iqdPreference)}
                        </div>
                        {metrics.isDeficit ? (
                            <div className="flex items-center gap-1 mt-2 text-[10px] font-bold text-red-600 dark:text-red-400">
                                <AlertTriangle className="w-3 h-3" />
                                {t('budget.dividendsExceedPool', 'Exceeds profit pool by')} {formatCurrency(Math.abs(metrics.finalNetProfit), baseCurrency, iqdPreference)}
                            </div>
                        ) : (
                            <p className="text-[10px] font-bold uppercase tracking-wider mt-2 opacity-60">
                                {t('budget.profitDistribution', 'Profit share distribution')}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Surplus Projection */}
                <Card
                    className={cn(
                        "cursor-pointer hover:scale-[1.02] transition-all active:scale-95 group relative overflow-hidden rounded-[2rem]",
                        metrics.isDeficit
                            ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 hover:bg-red-500/10 hover:shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)]'
                            : 'bg-violet-500/5 dark:bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/10 hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)]'
                    )}
                >
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        {metrics.finalNetProfit < 0
                            ? <AlertTriangle className="w-4 h-4 text-red-500" />
                            : <TrendingUp className="w-4 h-4 text-violet-500" />
                        }
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className={cn(
                            "text-xs font-black flex items-center gap-2 uppercase tracking-[0.2em]",
                            metrics.isDeficit ? 'text-red-600 dark:text-red-400' : 'text-violet-600 dark:text-violet-400'
                        )}>
                            {metrics.isDeficit ? <AlertTriangle className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                            {metrics.isDeficit ? t('budget.deficit', 'Deficit') : t('budget.netProfit', 'Surplus')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={cn(
                            "text-2xl font-black tracking-tighter tabular-nums",
                            metrics.isDeficit ? 'text-red-700 dark:text-red-300' : 'text-violet-700 dark:text-violet-300'
                        )}>
                            {metrics.isDeficit ? '-' : ''}{formatCurrency(Math.abs(metrics.finalNetProfit), baseCurrency, iqdPreference)}
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-2 opacity-60">
                            {metrics.isDeficit
                                ? t('budget.projectedDeficit', 'Dividends exceed profit')
                                : t('budget.projectedSurplus', 'Projected Surplus')
                            }
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
                                <div className="font-semibold flex items-center gap-2">
                                    {expense.description || t(`budget.cat.${expense.category}`)}
                                    {(expense as any).isRecurringVirtual && (
                                        <Repeat className="w-3 h-3 text-muted-foreground" />
                                    )}
                                </div>
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
                            <div className="flex gap-2">
                                {((expense.isVirtual && (expense as any).isRecurringVirtual) || (!expense.isVirtual)) && !(expense as any).isFired && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "hover:bg-emerald-500/10 hover:text-emerald-600",
                                            expense.status === 'paid' && "text-emerald-600"
                                        )}
                                        onClick={() => handleToggleStatus(expense)}
                                        title={expense.status === 'paid' ? t('budget.markUnpaid', 'Mark as Unpaid') : t('budget.markPaid', 'Mark as Paid')}
                                    >
                                        {expense.status === 'paid' ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                    </Button>
                                )}
                                {(!expense.isVirtual || (expense as any).isRecurringVirtual) && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                                        onClick={() => deleteExpense((expense as any).isRecurringVirtual ? (expense as any).originalTemplateId : expense.id)}
                                        title={(expense as any).isRecurringVirtual ? t('budget.deleteSeries', 'Delete Recurring Series') : t('common.delete', 'Delete')}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                )}
                            </div>
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
                                if (!workspaceId || isSaving) return

                                setIsSaving(true)
                                // Snap close for instant feeling
                                setIsAllocationDialogOpen(false)

                                try {
                                    await setBudgetAllocation(workspaceId, {
                                        month: monthStr,
                                        type: allocType,
                                        amount: parseFormattedNumber(allocAmountDisplay),
                                        currency: allocCurrency
                                    })
                                    toast({ description: t('budget.allocationSaved', 'Budget allocation updated') })
                                } catch (error) {
                                    toast({ variant: 'destructive', description: t('common.error', 'Failed to save budget') })
                                    setIsAllocationDialogOpen(true) // Restore if failed
                                } finally {
                                    setIsSaving(false)
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
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-bold uppercase tracking-widest opacity-60">
                                        {t('budget.estimatedBudgetLimit', 'Proposed Budget Limit')}
                                    </h4>
                                    <p className="text-sm font-black">
                                        {formatCurrency(
                                            allocType === 'fixed'
                                                ? convertToStoreBase(parseFormattedNumber(allocAmountDisplay), allocCurrency)
                                                : metrics.referenceProfit * (parseFormattedNumber(allocAmountDisplay) / 100),
                                            baseCurrency,
                                            iqdPreference
                                        )}
                                    </p>
                                </div>

                                <div className="flex justify-between items-center pt-2 border-t border-black/5 dark:border-white/5">
                                    <h4 className="text-xs font-bold uppercase tracking-widest opacity-60">
                                        {t('budget.actualSurplus', 'Projected Surplus')}
                                    </h4>
                                    <p className={cn(
                                        "text-sm font-black",
                                        (metrics.referenceProfit - (
                                            allocType === 'fixed'
                                                ? convertToStoreBase(parseFormattedNumber(allocAmountDisplay), allocCurrency)
                                                : metrics.referenceProfit * (parseFormattedNumber(allocAmountDisplay) / 100)
                                        )) >= 0 ? "text-emerald-600" : "text-red-600"
                                    )}>
                                        {formatCurrency(
                                            metrics.referenceProfit - (
                                                allocType === 'fixed'
                                                    ? convertToStoreBase(parseFormattedNumber(allocAmountDisplay), allocCurrency)
                                                    : metrics.referenceProfit * (parseFormattedNumber(allocAmountDisplay) / 100)
                                            ),
                                            baseCurrency,
                                            iqdPreference
                                        )}
                                    </p>
                                </div>
                                <p className="text-[10px] text-muted-foreground pt-1 italic">
                                    {t('budget.surplusNote', 'Remaining revenue after the proposed budget limit')}
                                </p>
                            </div>

                            <DialogFooter className="pt-4">
                                <Button type="submit" className="w-full">{t('common.save', 'Save Allocation')}</Button>
                            </DialogFooter>
                        </form>
                    </div>
                </DialogContent>
            </Dialog>

            <DividendDistributionModal
                isOpen={isDividendModalOpen}
                onClose={() => setIsDividendModalOpen(false)}
                recipients={metrics.dividendRecipients}
                surplus={metrics.finalNetProfit}
                baseCurrency={baseCurrency}
                iqdPreference={iqdPreference}
            />
        </div >
    )
}
