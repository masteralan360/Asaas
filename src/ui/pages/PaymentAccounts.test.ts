import { describe, expect, it } from 'vitest'

import type { PaymentTransaction } from '@/local-db/models'
import { paymentAccountMovementRelationKey } from '@/lib/paymentAccountRelations'

function paymentTransaction(overrides: Partial<PaymentTransaction>): PaymentTransaction {
  return {
    id: 'transaction-1',
    workspaceId: 'workspace-1',
    sourceModule: 'orders',
    sourceType: 'agent_commission_payout',
    sourceRecordId: 'agent-1',
    direction: 'outgoing',
    amount: 5000,
    currency: 'iqd',
    paymentMethod: 'cash',
    paidAt: '2026-08-29T00:00:00.000Z',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    version: 1,
    isDeleted: false,
    ...overrides,
  }
}

describe('paymentAccountMovementRelationKey', () => {
  it('relates an automatic commission payout to the order that funded it', () => {
    expect(paymentAccountMovementRelationKey(paymentTransaction({
      metadata: { orderId: 'order-109', automaticSettlement: true },
    }))).toBe('sales_order:order-109')
  })

  it('does not group historical payouts merely because they share an agent', () => {
    expect(paymentAccountMovementRelationKey(paymentTransaction({ metadata: null }))).toBeNull()
  })

  it('keeps the matching sales-order receipt in the same relationship', () => {
    expect(paymentAccountMovementRelationKey(paymentTransaction({
      sourceType: 'sales_order',
      sourceRecordId: 'order-109',
      direction: 'incoming',
      metadata: null,
    }))).toBe('sales_order:order-109')
  })
})
