interface AuthenticationState {
  hasSession: boolean
  hasUser: boolean
  canRestoreWithoutSession: boolean
}

export function isAuthenticatedState({
  hasSession,
  hasUser,
  canRestoreWithoutSession
}: AuthenticationState) {
  return hasUser && (hasSession || canRestoreWithoutSession)
}
