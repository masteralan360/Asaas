import { beforeEach, describe, expect, it } from 'vitest'

import {
  getWorkspaceDataFetchSource,
  readWorkspaceDataFetch,
  recordWorkspaceDataFetch,
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
})
