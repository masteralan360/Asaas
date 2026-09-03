export type AuthSessionClient<RefreshResult, SignOutResult> = {
  refreshSession: () => Promise<RefreshResult>
  signOut: (options: { scope: 'local' }) => Promise<SignOutResult>
}

/**
 * Coordinates manual refresh requests and limits sign-out to this device.
 *
 * Supabase Auth already serializes its internal session work. This manager
 * prevents Atlas's independent callers (wake handling, uploads, and function
 * calls) from initiating duplicate refreshes before the SDK receives them.
 */
export function createAuthSessionManager<RefreshResult, SignOutResult>(
  auth: AuthSessionClient<RefreshResult, SignOutResult>
) {
  let refreshPromise: Promise<RefreshResult> | null = null

  const refreshSession = () => {
    if (!refreshPromise) {
      refreshPromise = auth
        .refreshSession()
        .finally(() => {
          refreshPromise = null
        })
    }

    return refreshPromise
  }

  const signOutCurrentSession = () => auth.signOut({ scope: 'local' })

  return {
    refreshSession,
    signOutCurrentSession
  }
}
