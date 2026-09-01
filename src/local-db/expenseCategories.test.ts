import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000011'

let db: typeof import('./database').db
let createExpenseCategory: typeof import('./hooks').createExpenseCategory
let updateExpenseCategory: typeof import('./hooks').updateExpenseCategory
let deleteExpenseCategory: typeof import('./hooks').deleteExpenseCategory
let createExpenseSeries: typeof import('./hooks').createExpenseSeries
let DuplicateExpenseCategoryNameError: typeof import('./hooks').DuplicateExpenseCategoryNameError
let ExpenseCategoryInUseError: typeof import('./hooks').ExpenseCategoryInUseError
let setNetworkStatus: typeof import('@/lib/network').setNetworkStatus

function installBrowserGlobals() {
    const rows = new Map<string, string>()
    const documentHead = { appendChild: () => undefined }
    class TestDOMMatrix {}
    const storage = {
        get length() { return rows.size },
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => rows.set(key, value),
        removeItem: (key: string) => rows.delete(key),
        clear: () => rows.clear(),
        key: (index: number) => Array.from(rows.keys())[index] ?? null
    }

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: storage,
            sessionStorage: storage,
            location: { origin: 'http://localhost', hash: '', pathname: '/' },
            URL,
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            visibilityState: 'visible',
            dir: 'ltr',
            documentElement: { lang: 'en', dir: 'ltr' },
            head: documentHead,
            getElementsByTagName: () => [documentHead],
            createElement: () => ({ appendChild: () => undefined }),
            createTextNode: (value: string) => ({ textContent: value }),
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
    Object.defineProperty(globalThis, 'DOMMatrix', { configurable: true, value: TestDOMMatrix })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
}

describe('expense categories', () => {
    beforeAll(async () => {
        installBrowserGlobals()
        db = (await import('./database')).db
        const hooks = await import('./hooks')
        createExpenseCategory = hooks.createExpenseCategory
        updateExpenseCategory = hooks.updateExpenseCategory
        deleteExpenseCategory = hooks.deleteExpenseCategory
        createExpenseSeries = hooks.createExpenseSeries
        DuplicateExpenseCategoryNameError = hooks.DuplicateExpenseCategoryNameError
        ExpenseCategoryInUseError = hooks.ExpenseCategoryInUseError
        const network = await import('@/lib/network')
        setNetworkStatus = network.setNetworkStatus
        setNetworkStatus(false)
    }, 30000)

    beforeEach(async () => {
        await db.delete()
        await db.open()
    })

    afterAll(async () => {
        if (db) {
            await db.delete()
        }
        setNetworkStatus?.(true)
    })

    it('creates a normalized category and rejects duplicate names', async () => {
        const category = await createExpenseCategory(WORKSPACE_ID, '  Office   costs ')

        expect(category).toMatchObject({
            workspaceId: WORKSPACE_ID,
            name: 'Office costs',
            isDeleted: false,
            syncStatus: 'pending'
        })
        await expect(createExpenseCategory(WORKSPACE_ID, 'office costs')).rejects.toBeInstanceOf(DuplicateExpenseCategoryNameError)
    })

    it('updates a category and prevents deletion while an active expense uses it', async () => {
        const category = await createExpenseCategory(WORKSPACE_ID, 'Utilities')
        await updateExpenseCategory(category.id, 'Utilities and services')

        await createExpenseSeries(WORKSPACE_ID, {
            name: 'Internet',
            amount: 50,
            currency: 'usd',
            dueDay: 5,
            recurrence: 'monthly',
            startMonth: '2026-09',
            endMonth: null,
            categoryId: category.id,
            category: 'Utilities and services',
            subcategory: null
        })

        await expect(deleteExpenseCategory(category.id)).rejects.toBeInstanceOf(ExpenseCategoryInUseError)
        expect((await db.expense_categories.get(category.id))?.name).toBe('Utilities and services')
    })
})
