import type { PaymentTransaction } from '@/local-db/models'

/**
 * Returns the financial document relationship used to visually connect
 * payment-account movements. A commission payout belongs to the order that
 * funded it, not to every payout made to the same agent.
 */
export function paymentAccountMovementRelationKey(transaction: PaymentTransaction | null) {
  if (!transaction) return null

  switch (transaction.sourceType) {
    case 'loan_origination':
    case 'loan_payment':
    case 'simple_loan':
    case 'loan_installment':
      return `loan:${transaction.sourceRecordId}`
    case 'agent_commission_payout': {
      const orderId = transaction.metadata?.orderId
      return typeof orderId === 'string' && orderId.trim()
        ? `sales_order:${orderId}`
        : null
    }
    default:
      return `${transaction.sourceType}:${transaction.sourceRecordId}`
  }
}
