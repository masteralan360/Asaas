import { describe, expect, it, vi } from 'vitest'

import { createAuthSessionManager } from './sessionManager'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('auth session manager', () => {
  it('shares concurrent refreshes and allows a later refresh after success', async () => {
    const firstRefresh = createDeferred<{ session: string }>()
    const refreshSession = vi.fn(() => firstRefresh.promise)
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const manager = createAuthSessionManager({ refreshSession, signOut })

    const first = manager.refreshSession()
    const second = manager.refreshSession()

    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)

    firstRefresh.resolve({ session: 'refreshed-session' })
    await expect(first).resolves.toEqual({ session: 'refreshed-session' })

    await manager.refreshSession()
    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('releases the refresh coordinator after a failed refresh', async () => {
    const refreshSession = vi
      .fn<() => Promise<{ session: string }>>()
      .mockRejectedValueOnce(new Error('refresh token rejected'))
      .mockResolvedValueOnce({ session: 'recovered-session' })
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const manager = createAuthSessionManager({ refreshSession, signOut })

    await expect(manager.refreshSession()).rejects.toThrow('refresh token rejected')
    await expect(manager.refreshSession()).resolves.toEqual({ session: 'recovered-session' })

    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('signs out only the current device session', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ session: 'unused' })
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const manager = createAuthSessionManager({ refreshSession, signOut })

    await manager.signOutCurrentSession()

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
