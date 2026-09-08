import { describe, expect, it } from 'vitest'

import { isAuthenticatedState } from './authenticationState'

describe('authentication state', () => {
  it('does not authenticate a session before its user identity is ready', () => {
    expect(isAuthenticatedState({
      hasSession: true,
      hasUser: false,
      canRestoreWithoutSession: false
    })).toBe(false)
  })

  it('authenticates a paired online session and user', () => {
    expect(isAuthenticatedState({
      hasSession: true,
      hasUser: true,
      canRestoreWithoutSession: false
    })).toBe(true)
  })

  it('allows an eligible local or offline recovery user without a session', () => {
    expect(isAuthenticatedState({
      hasSession: false,
      hasUser: true,
      canRestoreWithoutSession: true
    })).toBe(true)
  })

  it('does not authenticate an online user without a session or eligible recovery', () => {
    expect(isAuthenticatedState({
      hasSession: false,
      hasUser: true,
      canRestoreWithoutSession: false
    })).toBe(false)
  })
})
