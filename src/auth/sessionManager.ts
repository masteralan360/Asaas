export type AuthSessionClient<RefreshResult, SignOutResult> = {
  refreshSession: () => Promise<RefreshResult>
  signOut: (options: { scope: 'local' }) => Promise<SignOutResult>
}

type AuthSessionManagerOptions = {
  now?: () => number
  rateLimitCooldownMs?: number
}

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000

/**
 * Detect the error shape returned by Supabase Auth when a refresh request is
 * throttled. Callers use this to preserve a recoverable local session instead
 * of treating a temporary 429 as a revoked login.
 */
export function isSupabaseRateLimitedError(error: unknown) {
  if (!error) return false

  if (typeof error === 'object') {
    const candidate = error as { status?: unknown; message?: unknown }
    if (candidate.status === 429) return true
    if (typeof candidate.message === 'string') {
      return /\b429\b|too many requests/i.test(candidate.message)
    }
  }

  return typeof error === 'string' && /\b429\b|too many requests/i.test(error)
}

function isRateLimitedRefreshResult(value: unknown) {
  if (!value || typeof value !== 'object') return false
  return isSupabaseRateLimitedError((value as { error?: unknown }).error)
}

/**
 * Coordinates manual refresh requests and limits sign-out to this device.
 *
 * Supabase Auth already serializes its internal session work. This manager
 * prevents Atlas's independent callers (wake handling, uploads, and function
 * calls) from initiating duplicate refreshes before the SDK receives them.
 */
export function createAuthSessionManager<RefreshResult, SignOutResult>(
  auth: AuthSessionClient<RefreshResult, SignOutResult>,
  options: AuthSessionManagerOptions = {}
) {
  let refreshPromise: Promise<RefreshResult> | null = null
  let rateLimitUntil = 0
  let lastRateLimitedResult: RefreshResult | null = null
  let lastRateLimitedError: unknown = null
  const now = options.now ?? Date.now
  const rateLimitCooldownMs = options.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS

  const refreshSession = () => {
    if (refreshPromise) return refreshPromise

    if (now() < rateLimitUntil) {
      if (lastRateLimitedResult !== null) {
        return Promise.resolve(lastRateLimitedResult)
      }
      return Promise.reject(lastRateLimitedError)
    }

    refreshPromise = auth
      .refreshSession()
      .then(
        (result) => {
          if (isRateLimitedRefreshResult(result)) {
            rateLimitUntil = now() + rateLimitCooldownMs
            lastRateLimitedResult = result
            lastRateLimitedError = null
          } else {
            rateLimitUntil = 0
            lastRateLimitedResult = null
            lastRateLimitedError = null
          }
          return result
        },
        (error) => {
          if (isSupabaseRateLimitedError(error)) {
            rateLimitUntil = now() + rateLimitCooldownMs
            lastRateLimitedResult = null
            lastRateLimitedError = error
          }
          throw error
        }
      )
      .finally(() => {
        refreshPromise = null
      })

    return refreshPromise
  }

  const signOutCurrentSession = () => auth.signOut({ scope: 'local' })

  return {
    refreshSession,
    signOutCurrentSession
  }
}
