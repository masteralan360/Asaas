import { beforeEach, describe, expect, it } from 'vitest'

import {
  cancelWorkspaceDataHydration,
  completeWorkspaceDataHydration,
  failWorkspaceDataHydration,
  getWorkspaceDataFetchSource,
  readWorkspaceDataHydration,
  readWorkspaceDataFetch,
  recordWorkspaceDataFetch,
  startWorkspaceDataHydration,
  updateWorkspaceDataHydrationProgress,
} from './workspaceDataFreshness'

function installBrowserStorage() {
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

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

describe('workspace data freshness', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('selects local freshness only for local data authorities', () => {
    expect(getWorkspaceDataFetchSource('local')).toBe('local')
    expect(getWorkspaceDataFetchSource('demo')).toBe('local')
    expect(getWorkspaceDataFetchSource('cloud')).toBe('supabase')
    expect(getWorkspaceDataFetchSource('hybrid')).toBe('supabase')
  })

  it('keeps Supabase and local fetch times separate for a workspace', () => {
    const workspaceId = 'workspace-1'
    recordWorkspaceDataFetch(workspaceId, 'supabase', '2026-08-01T12:00:00.000Z')
    recordWorkspaceDataFetch(workspaceId, 'local', '2026-08-01T13:00:00.000Z')

    expect(readWorkspaceDataFetch(workspaceId, 'supabase')?.fetchedAt).toBe('2026-08-01T12:00:00.000Z')
    expect(readWorkspaceDataFetch(workspaceId, 'local')?.fetchedAt).toBe('2026-08-01T13:00:00.000Z')
  })

  it('keeps a module freshness timestamp separate from unrelated table reads', () => {
    const workspaceId = 'workspace-table-freshness'
    recordWorkspaceDataFetch(workspaceId, 'supabase', '2026-08-01T12:00:00.000Z', 'products')

    expect(readWorkspaceDataFetch(workspaceId, 'supabase', ['sales'])).toBeNull()

    recordWorkspaceDataFetch(workspaceId, 'supabase', '2026-08-01T13:00:00.000Z', 'sales')
    expect(readWorkspaceDataFetch(workspaceId, 'supabase', ['sales'])?.fetchedAt).toBe('2026-08-01T13:00:00.000Z')
  })

  it('reports remote reads until the server has returned the final page', () => {
    const workspaceId = 'workspace-hydration'

    startWorkspaceDataHydration(workspaceId, 'supabase', 'products')
    updateWorkspaceDataHydrationProgress(workspaceId, 'supabase', 'products', 1_000)

    expect(readWorkspaceDataHydration(workspaceId, 'supabase')).toMatchObject({
      isLoading: true,
      activeTableNames: ['products'],
      recordsFetched: 1_000,
      lastResult: null,
    })

    completeWorkspaceDataHydration(workspaceId, 'supabase', 'products', '2026-08-01T12:00:00.000Z')

    expect(readWorkspaceDataHydration(workspaceId, 'supabase', ['sales'])?.lastResult).toBeNull()

    expect(readWorkspaceDataHydration(workspaceId, 'supabase')).toMatchObject({
      isLoading: false,
      activeTableNames: [],
      recordsFetched: 0,
      lastResult: { state: 'complete', at: '2026-08-01T12:00:00.000Z' },
    })
  })

  it('can cancel an abandoned read without presenting it as complete', () => {
    const workspaceId = 'workspace-cancelled-read'

    startWorkspaceDataHydration(workspaceId, 'supabase', 'products')
    cancelWorkspaceDataHydration(workspaceId, 'supabase', 'products')

    expect(readWorkspaceDataHydration(workspaceId, 'supabase')).toMatchObject({
      isLoading: false,
      activeTableNames: [],
      lastResult: null,
    })
  })

  it('does not hide a failed table when another table completes', () => {
    const workspaceId = 'workspace-partial-failure'

    startWorkspaceDataHydration(workspaceId, 'supabase', 'products')
    startWorkspaceDataHydration(workspaceId, 'supabase', 'categories')
    failWorkspaceDataHydration(workspaceId, 'supabase', 'products', '2026-08-01T12:00:00.000Z')
    completeWorkspaceDataHydration(workspaceId, 'supabase', 'categories', '2026-08-01T12:01:00.000Z')

    expect(readWorkspaceDataHydration(workspaceId, 'supabase')?.lastResult).toEqual({
      state: 'error',
      at: '2026-08-01T12:00:00.000Z',
    })
  })

  it('keeps a module loading until its most recent overlapping read finishes', () => {
    const workspaceId = 'workspace-overlapping-sales'

    startWorkspaceDataHydration(workspaceId, 'supabase', 'sales', 'first-date-range')
    startWorkspaceDataHydration(workspaceId, 'supabase', 'sales', 'second-date-range')
    completeWorkspaceDataHydration(workspaceId, 'supabase', 'sales', '2026-08-01T12:00:00.000Z', 'first-date-range')

    expect(readWorkspaceDataHydration(workspaceId, 'supabase', ['sales'])?.isLoading).toBe(true)

    completeWorkspaceDataHydration(workspaceId, 'supabase', 'sales', '2026-08-01T12:01:00.000Z', 'second-date-range')
    expect(readWorkspaceDataHydration(workspaceId, 'supabase', ['sales'])?.lastResult).toEqual({
      state: 'complete',
      at: '2026-08-01T12:01:00.000Z',
    })
  })
})
