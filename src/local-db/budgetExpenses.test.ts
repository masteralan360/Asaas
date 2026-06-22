import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const SERIES_ID = '00000000-0000-4000-8000-000000000002'

let db: typeof import('./database').db
let ensureExpenseItemsForMonth: typeof import('./hooks').ensureExpenseItemsForMonth

function installBrowserGlobals() {
    const rows = new Map<string, string>()
    const storage = {
        get length() {
            return rows.size
        },
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
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false }
    })
}

describe('expense item generation', () => {
    beforeAll(async () => {
        installBrowserGlobals()
        db = (await import('./database')).db
        ensureExpenseItemsForMonth = (await import('./hooks')).ensureExpenseItemsForMonth
    })

    beforeEach(async () => {
        await db.delete()
        await db.open()
        const now = new Date().toISOString()
        await db.expense_series.add({
            id: SERIES_ID,
            workspaceId: WORKSPACE_ID,
            name: 'Rent',
            amount: 1000,
            currency: 'usd',
            dueDay: 5,
            recurrence: 'monthly',
            startMonth: '2026-06',
            endMonth: null,
            category: null,
            subcategory: null,
            createdAt: now,
            updatedAt: now,
            syncStatus: 'pending',
            lastSyncedAt: null,
            version: 1,
            isDeleted: false
        })
    })

    afterAll(async () => {
        await db.delete()
    })

    it('coalesces concurrent ensure calls for the same workspace and month', async () => {
        await Promise.all([
            ensureExpenseItemsForMonth(WORKSPACE_ID, '2026-06'),
            ensureExpenseItemsForMonth(WORKSPACE_ID, '2026-06')
        ])

        const items = await db.expense_items.toArray()
        const mutations = await db.offline_mutations
            .where('entityType')
            .equals('expense_items')
            .toArray()

        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            workspaceId: WORKSPACE_ID,
            seriesId: SERIES_ID,
            month: '2026-06',
            dueDate: '2026-06-05'
        })
        expect(mutations).toHaveLength(1)
        expect(mutations[0].entityId).toBe(items[0].id)
    })
})
