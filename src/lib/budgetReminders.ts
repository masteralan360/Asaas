import type { Expense, Employee } from '@/local-db/models'
import { getAppSetting, setAppSetting } from '@/local-db/settings'


export type ReminderCategory = 'expense' | 'salary' | 'dividend'

/**
 * Special date string representing an indefinite/perpetual snooze.
 * Items with this date will stay snoozed until manually un-snoozed.
 */
export const INDEFINITE_SNOOZE_DATE = '9999-12-31T23:59:59.999Z'

/**
 * Robust check if a snooze date string represents an indefinite snooze.
 */
export function isIndefiniteSnooze(dateStr: any): boolean {
    if (!dateStr) return false
    try {
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) {
            return d.getFullYear() >= 9999
        }
        // Fallback for non-standard strings
        const s = String(dateStr)
        return s.startsWith('9999') || s.includes('10000') || s.includes('9999-12-31')
    } catch {
        const s = String(dateStr)
        return s.startsWith('9999') || s.includes('10000') || s.includes('9999-12-31')
    }
}

export interface BudgetReminderItem {
    id: string
    category: ReminderCategory
    title: string
    amount: number
    currency: string
    dueDate: string
    status: 'pending' | 'paid'
    // For real expenses
    expenseId?: string
    // For virtual items (salary/dividend)
    employeeId?: string
    employeeName?: string
    // Snooze state
    snoozeUntil: string | null
    snoozeCount: number
    // Lock state
    isLocked: boolean
    // Expense category for sub-styling
    expenseCategory?: string
    isRecurringTemplate?: boolean
    originalTemplateId?: string
}

export interface ReminderConfig {
    reminderDaysBefore: number // 0 = exact due date only
}

const DEFAULT_CONFIG: ReminderConfig = { reminderDaysBefore: 3 }
const CONFIG_KEY = 'budget_reminder_days_before'


export async function getReminderConfig(): Promise<ReminderConfig> {
    const val = await getAppSetting(CONFIG_KEY)
    if (val !== undefined && val !== null) {
        const days = parseInt(val, 10)
        if (!isNaN(days) && days >= 0) return { reminderDaysBefore: days }
    }
    return DEFAULT_CONFIG
}

export async function setReminderConfig(config: ReminderConfig): Promise<void> {
    await setAppSetting(CONFIG_KEY, String(config.reminderDaysBefore))
}


function snoozeKey(category: ReminderCategory, id: string, month: string): string {
    return `budget_snooze_${category}_${id}_${month}`
}

function paidKey(category: ReminderCategory, id: string, month: string): string {
    return `budget_paid_${category}_${id}_${month}`
}

export async function getVirtualSnooze(category: ReminderCategory, id: string, month: string): Promise<{ until: string | null; count: number }> {
    const raw = await getAppSetting(snoozeKey(category, id, month))
    if (!raw) return { until: null, count: 0 }
    try {
        const parsed = JSON.parse(raw)
        return { until: parsed.until || null, count: parsed.count || 0 }
    } catch {
        return { until: null, count: 0 }
    }
}

export async function setVirtualSnooze(category: ReminderCategory, id: string, month: string, until: string, count: number): Promise<void> {
    await setAppSetting(snoozeKey(category, id, month), JSON.stringify({ until, count }))
}

export async function getVirtualPaid(category: ReminderCategory, id: string, month: string): Promise<boolean> {
    const raw = await getAppSetting(paidKey(category, id, month))
    return raw === '1'
}

export async function setVirtualPaid(category: ReminderCategory, id: string, month: string, paid: boolean): Promise<void> {
    await setAppSetting(paidKey(category, id, month), paid ? '1' : '0')
}


export function isSnoozeActive(snoozeUntil: string | null): boolean {
    if (!snoozeUntil) return false
    return new Date(snoozeUntil) > new Date()
}


export function scanDueItems(
    expenses: Expense[],
    employees: Employee[],
    month: string, // "YYYY-MM"
    config: ReminderConfig,
    virtualSnoozeMap: Map<string, { until: string | null; count: number }>,
    virtualPaidMap?: Map<string, boolean>
): BudgetReminderItem[] {
    const now = new Date()
    const [yearStr, monthStr] = month.split('-')
    const year = parseInt(yearStr, 10)
    const mon = parseInt(monthStr, 10) - 1 // 0-indexed
    const monthStart = new Date(year, mon, 1)
    const monthEnd = new Date(year, mon + 1, 0, 23, 59, 59)
    const reminderHorizon = new Date(now)
    reminderHorizon.setDate(reminderHorizon.getDate() + config.reminderDaysBefore)

    const items: BudgetReminderItem[] = []

    const applicableExpenses = expenses.filter(e => {
        if (e.status === 'paid') return false
        if (e.isLocked) return false

        const due = new Date(e.dueDate)

        if (e.type === 'one-time') {
            // Skip paid payroll expenses (handled in salary pass).
            // But allow snoozed payroll expenses through so the snooze check
            // can populate virtualSnoozeMap for the salary pass.
            if (e.category === 'payroll' && e.employeeId && e.status !== 'snoozed') return false
            return due >= monthStart && due <= monthEnd
        }

        if (e.type === 'recurring') {
            return true // recurring templates project to current month
        }

        return false
    })

    for (const exp of applicableExpenses) {
        const dueDate = exp.type === 'recurring'
            ? new Date(year, mon, Math.min(new Date(exp.dueDate).getDate(), new Date(year, mon + 1, 0).getDate()))
            : new Date(exp.dueDate)

        // Check if already handled (recurring: match by description in one-time expenses)
        if (exp.type === 'recurring') {
            const hasInstance = expenses.some(e =>
                e.type === 'one-time' &&
                e.description?.trim().toLowerCase() === exp.description?.trim().toLowerCase() &&
                new Date(e.dueDate) >= monthStart &&
                new Date(e.dueDate) <= monthEnd
            )
            if (hasInstance) continue
        }

        // Only remind if due date is within reminder horizon
        if (dueDate > reminderHorizon) continue

        // Check snooze
        if (isSnoozeActive(exp.snoozeUntil)) {
            // If it's a snoozed payroll expense, it counts as treating the salary as snoozed
            // We don't want to show it due, but we'll track it in the virtual map so the Virtual Salary pass knows it's snoozed
            if (exp.category === 'payroll' && exp.employeeId) {
                virtualSnoozeMap.set(`salary_${exp.employeeId}`, {
                    until: exp.snoozeUntil,
                    count: exp.snoozeCount || 0
                })
            }
            continue
        }

        items.push({
            id: exp.id,
            category: 'expense',
            title: exp.description || exp.category,
            amount: exp.amount,
            currency: exp.currency,
            dueDate: dueDate.toISOString(),
            status: 'pending',
            expenseId: exp.id,
            snoozeUntil: exp.snoozeUntil,
            snoozeCount: exp.snoozeCount,
            isLocked: exp.isLocked || false,
            expenseCategory: exp.category,
            isRecurringTemplate: exp.type === 'recurring',
            originalTemplateId: exp.type === 'recurring' ? exp.id : undefined
        })
    }

    for (const emp of employees) {
        if (!emp.salary || emp.salary <= 0 || emp.isFired) continue

        // NOTE: We now populate `virtualSnoozeMap` for salaries during the Real Expenses pass 
        // if we encounter an active `snoozed` payroll expense.
        const snoozeStatus = virtualSnoozeMap.get(`salary_${emp.id}`)
        if (snoozeStatus && isSnoozeActive(snoozeStatus.until)) continue

        // The virtual item due date
        const pDay = Number(emp.salaryPayday) || 30
        let payDate = new Date(year, mon, Math.min(pDay, new Date(year, mon + 1, 0).getDate()))

        // Check for an existing payroll expense for this employee in the current month
        const existingPayrollExp = expenses.find(e =>
            e.type === 'one-time' &&
            e.category === 'payroll' &&
            e.employeeId === emp.id &&
            new Date(e.dueDate) >= monthStart &&
            new Date(e.dueDate) <= monthEnd
        )

        if (existingPayrollExp && existingPayrollExp.status === 'paid') continue

        // If snoozed or pending, link to the existing expense so future actions update it
        let finalDueDate = payDate.toISOString()
        let expenseIdForSalary: string | undefined = undefined
        if (existingPayrollExp && (existingPayrollExp.status === 'snoozed' || existingPayrollExp.status === 'pending')) {
            finalDueDate = existingPayrollExp.dueDate
            expenseIdForSalary = existingPayrollExp.id
        }

        if (new Date(finalDueDate) <= reminderHorizon) {
            items.push({
                id: existingPayrollExp?.id || `virtual_salary_${emp.id}_${monthStr}`,
                category: 'salary',
                title: `${emp.name}`,
                amount: emp.salary,
                currency: (emp.salaryCurrency as any) || 'usd',
                dueDate: finalDueDate,
                status: 'pending',
                employeeId: emp.id,
                employeeName: emp.name,
                expenseId: expenseIdForSalary,
                snoozeUntil: snoozeStatus?.until || null,
                snoozeCount: snoozeStatus?.count || 0,
                isLocked: false
            })
        }
    }

    for (const emp of employees) {
        if (!emp.hasDividends || !emp.dividendAmount || emp.dividendAmount <= 0 || emp.isFired) continue

        const pDay = Number(emp.dividendPayday) || 30
        const payDate = new Date(year, mon, Math.min(pDay, new Date(year, mon + 1, 0).getDate()))

        // Only remind if within horizon
        if (payDate > reminderHorizon) continue

        // Check virtual snooze
        const vKey = `dividend_${emp.id}`
        const vSnooze = virtualSnoozeMap.get(vKey)
        if (vSnooze && isSnoozeActive(vSnooze.until)) continue
        if (virtualPaidMap?.get(vKey)) continue

        items.push({
            id: `dividend-${emp.id}`,
            category: 'dividend',
            title: `${emp.name}`,
            amount: emp.dividendAmount,
            currency: (emp.dividendType === 'fixed' ? (emp.dividendCurrency || 'usd') : 'usd'),
            dueDate: payDate.toISOString(),
            status: 'pending',
            employeeId: emp.id,
            employeeName: emp.name,
            snoozeUntil: vSnooze?.until || null,
            snoozeCount: vSnooze?.count || 0,
            isLocked: false,
        })
    }

    // Sort by due date (earliest first)
    items.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

    return items
}


export function getSnoozedItems(
    expenses: Expense[],
    employees: Employee[],
    month: string, // "YYYY-MM"
    virtualSnoozeMap: Map<string, { until: string | null; count: number }>
): BudgetReminderItem[] {
    // const t = i18next.t.bind(i18next) // Assuming i18next is imported and available
    const [yearStr, monthStr_] = month.split('-')
    const year = parseInt(yearStr, 10)
    const mon = parseInt(monthStr_, 10) - 1 // 0-indexed
    const monthStart = new Date(year, mon, 1)
    const monthEnd = new Date(year, mon + 1, 0, 23, 59, 59)

    const snoozed: BudgetReminderItem[] = []

    const applicableExpenses = expenses.filter(e => {
        if (e.status !== 'snoozed') return false
        if (!isSnoozeActive(e.snoozeUntil)) return false

        const due = new Date(e.dueDate)

        if (e.type === 'one-time') {
            return due >= monthStart && due <= monthEnd
        }

        if (e.type === 'recurring') {
            return true
        }

        return false
    })

    for (const exp of applicableExpenses) {
        const dueDate = exp.type === 'recurring'
            ? new Date(year, mon, Math.min(new Date(exp.dueDate).getDate(), new Date(year, mon + 1, 0).getDate()))
            : new Date(exp.dueDate)

        snoozed.push({
            id: exp.id,
            category: exp.category === 'payroll' && exp.employeeId ? 'salary' : 'expense',
            title: exp.description || exp.category,
            amount: exp.amount,
            currency: exp.currency,
            dueDate: dueDate.toISOString(),
            status: 'snoozed' as any,
            expenseId: exp.id,
            employeeId: exp.employeeId,
            snoozeUntil: exp.snoozeUntil,
            snoozeCount: exp.snoozeCount || 0,
            isLocked: exp.isLocked || false,
            expenseCategory: exp.category,
            isRecurringTemplate: exp.type === 'recurring'
        })

        // Populate virtualSnoozeMap so the salary loop below skips rendering a duplicate
        if (exp.category === 'payroll' && exp.employeeId) {
            virtualSnoozeMap.set(`salary_${exp.employeeId}`, {
                until: exp.snoozeUntil,
                count: exp.snoozeCount || 0
            })
        }
    }

    // (Virtual Salaries are handled via Expense records now)
    for (const emp of employees) {
        if (!emp.hasDividends || !emp.dividendAmount || emp.dividendAmount <= 0 || emp.isFired) continue

        const vKey = `dividend_${emp.id}`
        const vSnooze = virtualSnoozeMap.get(vKey)

        if (vSnooze && isSnoozeActive(vSnooze.until)) {
            const pDay = Number(emp.dividendPayday) || 30
            const payDate = new Date(year, mon, Math.min(pDay, new Date(year, mon + 1, 0).getDate()))

            snoozed.push({
                id: `dividend-${emp.id}`,
                category: 'dividend',
                title: `${emp.name}`,
                amount: emp.dividendAmount,
                currency: (emp.dividendType === 'fixed' ? (emp.dividendCurrency || 'usd') : 'usd'),
                dueDate: payDate.toISOString(),
                status: 'pending',
                employeeId: emp.id,
                employeeName: emp.name,
                snoozeUntil: vSnooze.until,
                snoozeCount: vSnooze.count,
                isLocked: false,
            })
        }
    }

    snoozed.sort((a: BudgetReminderItem, b: BudgetReminderItem) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    return snoozed
}


