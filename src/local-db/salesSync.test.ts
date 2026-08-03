import 'fake-indexeddb/auto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => {
  const rows = new Map<string, string>()
  const storage = {
    get length() {
      return rows.size
    },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null,
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '' } })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { dir: '', documentElement: { lang: '', dir: '' } },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  return { storage }
})

const supabaseMocks = vi.hoisted(() => {
  const range = vi.fn()
  const order = vi.fn(() => ({ range }))
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, range }
})

vi.mock('@/auth/supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    schema: () => ({ from: supabaseMocks.from }),
  },
}))

vi.mock('@/lib/supabaseRequest', () => ({
  isRetriableWebRequestError: () => false,
  normalizeSupabaseActionError: (error: unknown) => error,
  runSupabaseAction: async (_label: string, action: () => Promise<unknown>) => action(),
}))

import { db } from './database'
import { syncSalesFromSupabase } from './hooks'

const WORKSPACE_ID = 'local-sales-reconciliation-guard'
const SALE_ID = 'local-sale-that-must-not-be-deleted'

describe('sales cloud reconciliation', () => {
  beforeAll(async () => {
    await db.open()
  })

  beforeEach(async () => {
    await db.delete()
    await db.open()
    vi.clearAllMocks()
    browser.storage.clear()
    supabaseMocks.range.mockResolvedValue({ data: [], error: null })
  })

  afterEach(async () => {
    await db.delete()
  })

  afterAll(async () => {
    await db.delete()
  })

  it('does not reconcile local sales when the browser mode snapshot is missing', async () => {
    // With no workspace-mode snapshot, the former code treated this workspace
    // as cloud. The persisted record must still protect local sales.
    await db.workspaces.put({
      id: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      data_mode: 'local',
    } as never)
    await db.sales.put({
      id: SALE_ID,
      workspaceId: WORKSPACE_ID,
      syncStatus: 'synced',
      version: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      isDeleted: false,
    } as never)

    await syncSalesFromSupabase(WORKSPACE_ID)

    expect(await db.sales.get(SALE_ID)).toMatchObject({ id: SALE_ID })
    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('cancels reconciliation when Local Mode is restored during the cloud request', async () => {
    await db.sales.put({
      id: SALE_ID,
      workspaceId: WORKSPACE_ID,
      syncStatus: 'synced',
      version: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      isDeleted: false,
    } as never)
    supabaseMocks.range.mockImplementationOnce(async () => {
      await db.workspaces.put({
        id: WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
        data_mode: 'local',
      } as never)
      return { data: [], error: null }
    })

    await syncSalesFromSupabase(WORKSPACE_ID)

    expect(await db.sales.get(SALE_ID)).toMatchObject({ id: SALE_ID })
    expect(supabaseMocks.from).toHaveBeenCalledOnce()
  })
})
