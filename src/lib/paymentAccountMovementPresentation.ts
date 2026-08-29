import type { PaymentAccountMovement, PaymentTransaction } from '@/local-db/models'

export const PAYMENT_ACCOUNT_REVERSAL_EPSILON = 0.000001

export type PaymentAccountMovementReversalStatus = 'posted' | 'partially_reversed' | 'reversed'

export interface PaymentAccountMovementPresentation {
  /** The amount that still affects the account after linked reversals. */
  amount: number
  /** The signed balance effect that still remains after linked reversals. */
  deltaAmount: number
  reversalStatus: PaymentAccountMovementReversalStatus
  reversedAmount: number
}

/**
 * Build the account-view equivalent of Ledger's remaining-payment projection.
 *
 * Payment transactions are immutable: a reversal is an additional signed row,
 * never an edit to the original payment. The payment-account movement table is
 * an audit trail, but its overview, filters, and charts must show the same net
 * financial effect as Ledger. The original row therefore carries the remaining
 * effect and its reversal row is intentionally omitted by the caller.
 */
export function getPaymentAccountMovementPresentation(
  movement: Pick<PaymentAccountMovement, 'amount' | 'deltaAmount'>,
  transaction: Pick<PaymentTransaction, 'id' | 'amount'> | null,
  reversalAmounts: ReadonlyMap<string, number>,
): PaymentAccountMovementPresentation {
  const sourceAmount = Number(movement.amount || 0)
  const sourceDelta = Number(movement.deltaAmount || 0)

  if (!transaction) {
    return {
      amount: sourceAmount,
      deltaAmount: sourceDelta,
      reversalStatus: 'posted',
      reversedAmount: 0,
    }
  }

  const originalMagnitude = Math.abs(Number(transaction.amount || sourceAmount))
  const reversedAmount = Math.max(0, Number(reversalAmounts.get(transaction.id) || 0))
  if (reversedAmount <= PAYMENT_ACCOUNT_REVERSAL_EPSILON) {
    return {
      amount: sourceAmount,
      deltaAmount: sourceDelta,
      reversalStatus: 'posted',
      reversedAmount: 0,
    }
  }

  const remainingMagnitude = Math.max(0, originalMagnitude - reversedAmount)
  const amountSign = Math.sign(sourceAmount) || Math.sign(Number(transaction.amount || 0)) || 1
  const deltaSign = Math.sign(sourceDelta) || 1
  const isFullyReversed = remainingMagnitude <= PAYMENT_ACCOUNT_REVERSAL_EPSILON

  return {
    amount: isFullyReversed ? 0 : amountSign * remainingMagnitude,
    deltaAmount: isFullyReversed ? 0 : deltaSign * remainingMagnitude,
    reversalStatus: isFullyReversed ? 'reversed' : 'partially_reversed',
    reversedAmount,
  }
}
