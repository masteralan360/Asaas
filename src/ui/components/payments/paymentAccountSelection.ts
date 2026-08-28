import type { PaymentAccount } from '@/local-db'

export interface PaymentAccountSelectionState {
  /** The controlled value that Radix receives. This never silently becomes ledger-only. */
  selectedValue: string | undefined
  /** The best known snapshot for the selected account, including during a refresh. */
  selectedAccount: PaymentAccount | null
  /** The selected account no longer satisfies this selector's current filter. */
  selectionNeedsReview: boolean
  /** No current or retained snapshot can resolve the selected account ID. */
  selectionUnavailable: boolean
  /** Includes a retained selected account so the menu and trigger stay in agreement. */
  displayOptions: PaymentAccount[]
}

/**
 * Resolve a controlled payment-account selection without turning an existing
 * account choice into "No account" while the account list refreshes or a
 * contextual filter changes. Ledger-only remains an explicit user action.
 */
export function resolvePaymentAccountSelection(
  value: string | null | undefined,
  accounts: readonly PaymentAccount[],
  options: readonly PaymentAccount[],
  lastKnownAccount: PaymentAccount | null,
  allowNoAccount: boolean,
): PaymentAccountSelectionState {
  const liveSelectedAccount = value
    ? accounts.find((account) => account.id === value) ?? null
    : null
  const retainedSelectedAccount = value && lastKnownAccount?.id === value
    ? lastKnownAccount
    : null
  const selectedAccount = liveSelectedAccount ?? retainedSelectedAccount
  const selectionNeedsReview = Boolean(
    selectedAccount && !options.some((account) => account.id === selectedAccount.id),
  )
  const selectionUnavailable = Boolean(value && !selectedAccount)
  const displayOptions = selectedAccount && !options.some((account) => account.id === selectedAccount.id)
    ? [selectedAccount, ...options]
    : [...options]

  return {
    selectedValue: value ?? (allowNoAccount ? '__none__' : undefined),
    selectedAccount,
    selectionNeedsReview,
    selectionUnavailable,
    displayOptions,
  }
}
