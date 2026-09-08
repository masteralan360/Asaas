export type AuthSessionClient<RefreshResult, SignOutResult> = {
  refreshSession: () => Promise<RefreshResult>
  signOut: (options: { scope: 'local' }) => Promise<SignOutResult>
}

/**
 * Detect the error shape returned by Supabase Auth when a refresh request is
 * throttled. Callers use this to preserve a recoverable local session instead
 * of treating a temporary 429 as a revoked login.
 */
export function isSupabaseRateLimitedError(error: unknown) {
  if (!error) return false

  if (typeof error === 'object') {
    const candidate = error as {
      status?: unknown
      code?: unknown
      error_code?: unknown
      message?: unknown
    }
    if (candidate.status === 429) return true
    if (candidate.code === 'over_request_rate_limit' || candidate.error_code === 'over_request_rate_limit') {
      return true
    }
    if (typeof candidate.message === 'string') {
      return /\b429\b|too many requests|request rate limit reached|rate limit exceeded/i.test(candidate.message)
    }
  }

  return typeof error === 'string'
    && /\b429\b|too many requests|request rate limit reached|rate limit exceeded|over_request_rate_limit/i.test(error)
}

/**
 * Shares concurrent manual refreshes and limits sign-out to this device.
 *
 * Supabase Auth owns refresh retry, backoff, and cooldown behavior. This small
 * coordinator only prevents Atlas's independent callers from starting the
 * same refresh at the same time.
 */
export function createAuthSessionManager<RefreshResult, SignOutResult>(
  auth: AuthSessionClient<RefreshResult, SignOutResult>
) {
  let refreshPromise: Promise<RefreshResult> | null = null

  const refreshSession = () => {
    if (refreshPromise) return refreshPromise

    refreshPromise = auth
      .refreshSession()
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
