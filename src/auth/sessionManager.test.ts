import { describe, expect, it, vi } from 'vitest'

import { createAuthSessionManager, isSupabaseRateLimitedError } from './sessionManager'

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
  it('recognizes Supabase request-rate-limit error variants', () => {
    expect(isSupabaseRateLimitedError({ status: 429 })).toBe(true)
    expect(isSupabaseRateLimitedError({
      code: 'over_request_rate_limit',
      message: 'Request rate limit reached'
    })).toBe(true)
    expect(isSupabaseRateLimitedError({
      error_code: 'over_request_rate_limit',
      message: 'Request rate limit reached'
    })).toBe(true)
    expect(isSupabaseRateLimitedError('over_request_rate_limit')).toBe(true)
    expect(isSupabaseRateLimitedError({
      code: 'invalid_credentials',
      message: 'Invalid login credentials'
    })).toBe(false)
  })

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

  it('does not retry a rate-limited refresh until its cooldown has elapsed', async () => {
    let currentTime = 1_000
    const rateLimitedResult = {
      data: { session: null },
      error: {
        code: 'over_request_rate_limit',
        message: 'Request rate limit reached'
      }
    }
    const recoveredResult = {
      data: { session: 'recovered-session' },
      error: null
    }
    const refreshSession = vi
      .fn<() => Promise<typeof rateLimitedResult | typeof recoveredResult>>()
      .mockResolvedValueOnce(rateLimitedResult)
      .mockResolvedValueOnce(recoveredResult)
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const manager = createAuthSessionManager({ refreshSession, signOut }, {
      now: () => currentTime,
      rateLimitCooldownMs: 60_000
    })

    await expect(manager.refreshSession()).resolves.toBe(rateLimitedResult)
    await expect(manager.refreshSession()).resolves.toBe(rateLimitedResult)
    expect(refreshSession).toHaveBeenCalledTimes(1)

    currentTime += 60_000
    await expect(manager.refreshSession()).resolves.toBe(recoveredResult)
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
