import { describe, expect, it } from 'vitest'

import { getPaymentAccountMovementPresentation } from './paymentAccountMovementPresentation'

const outgoingMovement = { amount: 400, deltaAmount: -400 } as const
const outgoingTransaction = { id: 'original-outflow', amount: 400 } as const

describe('getPaymentAccountMovementPresentation', () => {
  it('matches Ledger by netting a fully reversed account movement to zero', () => {
    expect(getPaymentAccountMovementPresentation(
      outgoingMovement,
      outgoingTransaction,
      new Map([[outgoingTransaction.id, 400]]),
    )).toEqual({
      amount: 0,
      deltaAmount: 0,
      reversalStatus: 'reversed',
      reversedAmount: 400,
    })
  })

  it('keeps only the remaining effect for a partial reversal', () => {
    expect(getPaymentAccountMovementPresentation(
      outgoingMovement,
      outgoingTransaction,
      new Map([[outgoingTransaction.id, 125]]),
    )).toEqual({
      amount: 275,
      deltaAmount: -275,
      reversalStatus: 'partially_reversed',
      reversedAmount: 125,
    })
  })

  it('leaves an unreversed movement unchanged', () => {
    expect(getPaymentAccountMovementPresentation(
      outgoingMovement,
      outgoingTransaction,
      new Map(),
    )).toEqual({
      amount: 400,
      deltaAmount: -400,
      reversalStatus: 'posted',
      reversedAmount: 0,
    })
  })

  it('preserves the original incoming direction when only part remains', () => {
    expect(getPaymentAccountMovementPresentation(
      { amount: 400, deltaAmount: 400 },
      { id: 'original-inflow', amount: 400 },
      new Map([['original-inflow', 150]]),
    )).toEqual({
      amount: 250,
      deltaAmount: 250,
      reversalStatus: 'partially_reversed',
      reversedAmount: 150,
    })
  })
})
