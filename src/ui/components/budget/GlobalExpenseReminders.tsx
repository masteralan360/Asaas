import { useState, useEffect } from 'react'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { BudgetReminderModal } from './BudgetReminderModal'
import { BudgetLockModal } from './BudgetLockModal'
import { BudgetSnoozeModal } from './BudgetSnoozeModal'
import { scanDueItems, getReminderConfig, getVirtualSnooze } from '@/lib/budgetReminders'
import type { BudgetReminderItem } from '@/lib/budgetReminders'
import { updateExpense, createExpense, fetchTableFromSupabase } from '@/local-db/hooks'
import { db } from '@/local-db/database'
import { useToast } from '@/ui/components'
import { useTranslation } from 'react-i18next'

export function GlobalExpenseReminders() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const workspaceId = user?.workspaceId
    const { toast } = useToast()
    const { t } = useTranslation()

    const [queue, setQueue] = useState<BudgetReminderItem[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [step, setStep] = useState<'idle' | 'reminder' | 'lock' | 'snooze'>('idle')

    useEffect(() => {
        if (!user || !workspaceId) return

        let mounted = true

        const checkOverdueExpenses = async () => {
            try {
                console.log('[GlobalExpenseReminders] Startup/Refresh check: syncing and querying for overdue items...')

                // Force an immediate fetch from Supabase to guarantee zero latency public data checking
                await Promise.all([
                    fetchTableFromSupabase('expenses', db.expenses, workspaceId),
                    fetchTableFromSupabase('employees', db.employees, workspaceId)
                ])

                if (!mounted) return

                const expenses = await db.expenses.where('workspaceId').equals(workspaceId).toArray()
                const employees = await db.employees.where('workspaceId').equals(workspaceId).toArray()

                const now = new Date()
                const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                const config = await getReminderConfig()

                const virtualSnoozeMap = new Map<string, { until: string | null; count: number }>()

                // Pre-fill virtualSnoozeMap for dividends
                for (const emp of employees) {
                    if (emp.hasDividends && emp.dividendAmount && emp.dividendAmount > 0) {
                        const vd = await getVirtualSnooze('dividend', emp.id, monthStr)
                        if (vd.until || vd.count > 0) virtualSnoozeMap.set(`dividend_${emp.id}`, vd)
                    }
                }

                const items = scanDueItems(expenses, employees, monthStr, config, virtualSnoozeMap)

                // Filter strictly for OVERDUE ones for the persistent alert
                const validOverdue = items.filter(item => {
                    const due = new Date(item.dueDate)
                    // Pop up if past due date OR due today
                    return due < now || Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) <= 0
                })

                if (validOverdue.length > 0) {
                    console.log(`[GlobalExpenseReminders] Firing persistent popup for ${validOverdue.length} items!`, validOverdue)
                    setQueue(validOverdue)
                    setCurrentIndex(0)
                    setStep('reminder')
                } else {
                    console.log('[GlobalExpenseReminders] All candidates were filtered out or handled.')
                }
            } catch (err) {
                console.error('[GlobalExpenseReminders] Unexpected error during check:', err)
            }
        }

        // Run on mount
        checkOverdueExpenses()

        // Persistent background checks every 5 minutes just in case
        const interval = setInterval(checkOverdueExpenses, 5 * 60 * 1000)

        // Also run when window regains focus (user came back to tab)
        window.addEventListener('focus', checkOverdueExpenses)

        return () => {
            mounted = false
            clearInterval(interval)
            window.removeEventListener('focus', checkOverdueExpenses)
        }
    }, [user, workspaceId])

    const currentItem = queue[currentIndex] || null

    const advance = () => {
        const next = currentIndex + 1
        if (next < queue.length) {
            setCurrentIndex(next)
            setStep('reminder')
        } else {
            setStep('idle')
            setQueue([]) // Clear queue
        }
    }

    const handlePaid = async () => {
        if (!currentItem || !workspaceId) return

        try {
            console.log(`[GlobalExpenseReminders] Marking ${currentItem.category} as paid`)
            if (currentItem.category === 'salary' && currentItem.employeeId) {
                const newExp = await createExpense(workspaceId, {
                    description: currentItem.title,
                    type: 'one-time',
                    category: 'payroll',
                    amount: currentItem.amount,
                    currency: currentItem.currency as any,
                    status: 'paid',
                    dueDate: currentItem.dueDate,
                    paidAt: new Date().toISOString(),
                    snoozeUntil: null,
                    snoozeCount: 0,
                    employeeId: currentItem.employeeId
                })
                if (newExp) currentItem.expenseId = newExp.id
            } else if (currentItem.expenseId) {
                if (currentItem.isRecurringTemplate) {
                    const newExp = await createExpense(workspaceId, {
                        description: currentItem.title,
                        type: 'one-time',
                        category: currentItem.expenseCategory as any || 'operational',
                        amount: currentItem.amount,
                        currency: currentItem.currency as any,
                        status: 'paid',
                        dueDate: currentItem.dueDate,
                        paidAt: new Date().toISOString(),
                        snoozeUntil: null,
                        snoozeCount: 0
                    })
                    if (newExp) currentItem.expenseId = newExp.id
                } else {
                    await updateExpense(currentItem.expenseId, {
                        status: 'paid',
                        paidAt: new Date().toISOString()
                    })
                }
            }
            toast({ description: t('budget.statusUpdated', 'Status updated') })
            setStep('lock')
        } catch (err) {
            console.error('[GlobalExpenseReminders] Error marking paid:', err)
            toast({ variant: 'destructive', description: t('common.error', 'Failed to update') })
            advance()
        }
    }

    const handleLock = async () => {
        if (!currentItem || !currentItem.expenseId) return

        try {
            console.log(`[GlobalExpenseReminders] Locking expense ${currentItem.expenseId}`)
            await updateExpense(currentItem.expenseId, { isLocked: true })
            toast({ description: t('budget.expenseLocked', 'Payment locked') })
        } catch (err) {
            console.error('[GlobalExpenseReminders] Error locking:', err)
            toast({ variant: 'destructive', description: t('budget.errorLocking', 'Error locking') })
        }
        advance()
    }

    const handleLockSkip = () => advance()

    const handleSnoozeOpen = () => setStep('snooze')

    const handleSnooze = async (minutes: number) => {
        if (!currentItem || !workspaceId) return

        const snoozeUntil = new Date(Date.now() + minutes * 60000).toISOString()
        const newCount = (currentItem.snoozeCount || 0) + 1

        try {
            console.log(`[GlobalExpenseReminders] Snoozing ${currentItem.category} for ${minutes} min until ${snoozeUntil}`)
            if (currentItem.category === 'salary' && currentItem.employeeId) {
                if (currentItem.expenseId) {
                    await updateExpense(currentItem.expenseId, {
                        snoozeUntil,
                        snoozeCount: newCount,
                        status: 'snoozed'
                    })
                } else {
                    await createExpense(workspaceId, {
                        description: currentItem.title,
                        type: 'one-time',
                        category: 'payroll',
                        amount: currentItem.amount,
                        currency: currentItem.currency as any,
                        status: 'snoozed',
                        dueDate: currentItem.dueDate || new Date().toISOString(),
                        paidAt: null,
                        snoozeUntil,
                        snoozeCount: newCount,
                        employeeId: currentItem.employeeId
                    })
                }
            } else if (currentItem.expenseId) {
                await updateExpense(currentItem.expenseId, {
                    snoozeUntil,
                    snoozeCount: newCount,
                    status: 'snoozed' // Maintain standard flow
                })
            }
        } catch (err) {
            console.error('[GlobalExpenseReminders] Error snoozing:', err)
        }
        advance()
    }

    const handleSnoozeDismiss = () => advance()

    if (step === 'idle' || !currentItem) return null

    return (
        <>
            <BudgetReminderModal
                isOpen={step === 'reminder'}
                onPaid={handlePaid}
                onSnooze={handleSnoozeOpen}
                item={currentItem}
                queuePosition={currentIndex + 1}
                queueTotal={queue.length}
                iqdPreference={features.default_currency === 'usd' ? undefined : (features as any).primary_iqd_rate}
            />

            <BudgetLockModal
                isOpen={step === 'lock'}
                onLock={handleLock}
                onSkip={handleLockSkip}
                item={currentItem}
            />

            <BudgetSnoozeModal
                isOpen={step === 'snooze'}
                onSnooze={handleSnooze}
                onDismiss={handleSnoozeDismiss}
                item={currentItem}
            />
        </>
    )
}
