import type { Expense, Employee } from '@/local-db/models'
import { getAppSetting, setAppSetting } from '@/local-db/settings'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReminderCategory = 'expense' | 'salary' | 'dividend'

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
}

export interface ReminderConfig {
    reminderDaysBefore: number // 0 = exact due date only
}

const DEFAULT_CONFIG: ReminderConfig = { reminderDaysBefore: 3 }
const CONFIG_KEY = 'budget_reminder_days_before'

// ─── Config Persistence ─────────────────────────────────────────────────────

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

// ─── Virtual Item Snooze (app_settings based) ───────────────────────────────

function snoozeKey(category: ReminderCategory, id: string, month: string): string {
    return `budget_snooze_${category}_${id}_${month}`
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

// ─── Snooze Check ───────────────────────────────────────────────────────────

export function isSnoozeActive(snoozeUntil: string | null): boolean {
    if (!snoozeUntil) return false
    return new Date(snoozeUntil) > new Date()
}

// ─── Scanner ────────────────────────────────────────────────────────────────

export function scanDueItems(
    expenses: Expense[],
    employees: Employee[],
    month: string, // "YYYY-MM"
    config: ReminderConfig,
    virtualSnoozeMap: Map<string, { until: string | null; count: number }>
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

    // ─── 1. Real Expenses (one-time + recurring virtual projections) ────────
    const applicableExpenses = expenses.filter(e => {
        if (e.isDeleted) return false
        if (e.status === 'paid') return false
        if (e.isLocked) return false

        const due = new Date(e.dueDate)

        if (e.type === 'one-time') {
            if (e.category === 'payroll' && e.employeeId) return false
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

        // Check if already paid (recurring: match by description in one-time expenses)
        if (exp.type === 'recurring') {
            const isPaid = expenses.some(e =>
                e.type === 'one-time' &&
                !e.isDeleted &&
                e.description?.trim().toLowerCase() === exp.description?.trim().toLowerCase() &&
                new Date(e.dueDate) >= monthStart &&
                new Date(e.dueDate) <= monthEnd
            )
            if (isPaid) continue
        }

        // Only remind if due date is within reminder horizon
        if (dueDate > reminderHorizon) continue

        // Check snooze
        if (isSnoozeActive(exp.snoozeUntil)) continue

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
        })
    }

    // ─── 2. Salaries ────────────────────────────────────────────────────────
    for (const emp of employees) {
        if (!emp.salary || emp.salary <= 0 || emp.isFired || emp.isDeleted) continue

        const pDay = Number(emp.salaryPayday) || 30
        const payDate = new Date(year, mon, Math.min(pDay, new Date(year, mon + 1, 0).getDate()))

        // Already paid?
        const existingPayroll = expenses.find(e =>
            e.type === 'one-time' &&
            e.category === 'payroll' &&
            e.employeeId === emp.id &&
            new Date(e.dueDate) >= monthStart &&
            new Date(e.dueDate) <= monthEnd &&
            !e.isDeleted
        )
        if (existingPayroll) continue

        // Only remind if within horizon
        if (payDate > reminderHorizon) continue

        // Check virtual snooze
        const vKey = `salary_${emp.id}`
        const vSnooze = virtualSnoozeMap.get(vKey)
        if (vSnooze && isSnoozeActive(vSnooze.until)) continue

        items.push({
            id: `salary-${emp.id}`,
            category: 'salary',
            title: `${emp.name}`,
            amount: emp.salary,
            currency: emp.salaryCurrency || 'usd',
            dueDate: payDate.toISOString(),
            status: 'pending',
            employeeId: emp.id,
            employeeName: emp.name,
            snoozeUntil: vSnooze?.until || null,
            snoozeCount: vSnooze?.count || 0,
            isLocked: false,
        })
    }

    // ─── 3. Dividends ───────────────────────────────────────────────────────
    for (const emp of employees) {
        if (!emp.hasDividends || !emp.dividendAmount || emp.dividendAmount <= 0 || emp.isFired || emp.isDeleted) continue

        const pDay = Number(emp.dividendPayday) || 30
        const payDate = new Date(year, mon, Math.min(pDay, new Date(year, mon + 1, 0).getDate()))

        // For dividends, "paid" is evaluated by date comparison in Budget.tsx
        if (now >= payDate) continue // Already past due — treated as paid by budget

        // Only remind if within horizon
        if (payDate > reminderHorizon) continue

        // Check virtual snooze
        const vKey = `dividend_${emp.id}`
        const vSnooze = virtualSnoozeMap.get(vKey)
        if (vSnooze && isSnoozeActive(vSnooze.until)) continue

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
