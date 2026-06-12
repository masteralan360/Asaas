import { beforeEach, describe, expect, it } from 'vitest'

import {
  getWorkspaceDataMode,
  isDemoWorkspaceMode,
  isLocalWorkspaceMode,
  normalizeWorkspaceDataMode,
  shouldMirrorToSqlite,
  writeWorkspaceModeSnapshot,
} from './workspaceMode'

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

describe('workspace data modes', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('preserves demo as an explicit data mode', () => {
    expect(normalizeWorkspaceDataMode('demo')).toBe('demo')
    expect(normalizeWorkspaceDataMode('unexpected')).toBe('cloud')
  })

  it('uses demo as local business storage without enabling SQLite mirroring', () => {
    writeWorkspaceModeSnapshot({
      workspaceId: 'demo-workspace',
      dataMode: 'demo',
    })

    expect(getWorkspaceDataMode('demo-workspace')).toBe('demo')
    expect(isDemoWorkspaceMode('demo-workspace')).toBe(true)
    expect(isLocalWorkspaceMode('demo-workspace')).toBe(true)
    expect(shouldMirrorToSqlite('demo-workspace')).toBe(false)
  })
})
