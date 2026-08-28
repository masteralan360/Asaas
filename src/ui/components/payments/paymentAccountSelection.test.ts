import { describe, expect, it } from 'vitest'

import type { PaymentAccount } from '@/local-db'

import { resolvePaymentAccountEffectiveValue, resolvePaymentAccountSelection } from './paymentAccountSelection'

const account = {
  id: 'account-1',
  workspaceId: 'workspace-1',
  name: 'Main Cash Drawer',
  accountType: 'cash_drawer',
  isActive: true,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  version: 1,
  syncStatus: 'synced',
  lastSyncedAt: null,
  isDeleted: false,
} as PaymentAccount

describe('resolvePaymentAccountSelection', () => {
  it('keeps a selected account visible while the account list is temporarily unavailable', () => {
    const result = resolvePaymentAccountSelection(account.id, [], [], account, true)

    expect(result.selectedValue).toBe(account.id)
    expect(result.selectedAccount).toEqual(account)
    expect(result.selectionNeedsReview).toBe(true)
    expect(result.selectionUnavailable).toBe(false)
    expect(result.displayOptions).toEqual([account])
  })

  it('does not silently substitute ledger-only when a contextual filter hides the selected account', () => {
    const result = resolvePaymentAccountSelection(account.id, [account], [], null, true)

    expect(result.selectedValue).toBe(account.id)
    expect(result.selectedAccount).toEqual(account)
    expect(result.displayOptions).toEqual([account])
  })

  it('shows an unresolved selected ID as unavailable instead of ledger-only', () => {
    const result = resolvePaymentAccountSelection('account-no-longer-loaded', [], [], null, true)

    expect(result.selectedValue).toBe('account-no-longer-loaded')
    expect(result.selectedAccount).toBeNull()
    expect(result.selectionUnavailable).toBe(true)
  })

  it('uses ledger-only only when the parent explicitly clears the selection', () => {
    const result = resolvePaymentAccountSelection(null, [account], [account], account, true)

    expect(result.selectedValue).toBe('__none__')
    expect(result.selectedAccount).toBeNull()
    expect(result.selectionUnavailable).toBe(false)
  })
})

describe('resolvePaymentAccountEffectiveValue', () => {
  it('retains a resolved selection while a parent form temporarily clears its controlled value', () => {
    expect(resolvePaymentAccountEffectiveValue(null, account, false)).toBe(account.id)
  })

  it('honors the explicit ledger-only choice even when an account was previously retained', () => {
    expect(resolvePaymentAccountEffectiveValue(null, account, true)).toBeNull()
  })
})
