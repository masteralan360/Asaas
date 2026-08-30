/**
 * Opening balances establish an account's starting position, while adjustments
 * reconcile its recorded position. Both remain in the audit trail without
 * becoming cash flow for the period.
 */
export type LedgerReportingDirection = 'incoming' | 'outgoing' | 'opening' | 'adjustment'

export interface LedgerFlowEntry {
  direction: LedgerReportingDirection
  amount: number
}

export function isLedgerCashFlowDirection(
  direction: LedgerReportingDirection
): direction is Exclude<LedgerReportingDirection, 'opening'> {
  return direction === 'incoming' || direction === 'outgoing'
}

export function getLedgerFlowSign(direction: LedgerReportingDirection) {
  if (direction === 'incoming') return 1
  if (direction === 'outgoing') return -1
  return 0
}

function roundLedgerTotal(amount: number) {
  return Number(amount.toFixed(8))
}

export function summarizeLedgerCashFlow<T extends LedgerFlowEntry>(
  entries: readonly T[],
  getAmount: (entry: T) => number = (entry) => entry.amount
) {
  const totals = entries.reduce(
    (current, entry) => {
      const amount = getAmount(entry)
      if (!Number.isFinite(amount)) return current

      if (entry.direction === 'incoming') current.inflow += amount
      if (entry.direction === 'outgoing') current.outflow += amount
      return current
    },
    { inflow: 0, outflow: 0 }
  )

  const inflow = roundLedgerTotal(totals.inflow)
  const outflow = roundLedgerTotal(totals.outflow)
  return { inflow, outflow, net: roundLedgerTotal(inflow - outflow) }
}
