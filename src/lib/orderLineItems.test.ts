import { describe, expect, it } from 'vitest'

import {
  getOrderLineFreeBonusQuantity,
  getOrderLineInventoryQuantity,
  getOrderLinePaidQuantity,
  hasOrderLineFreeBonus
} from './orderLineItems'

describe('order line item quantity normalization', () => {
  it('treats legacy items without free bonus as zero bonus', () => {
    const item = { quantity: 5 }

    expect(getOrderLinePaidQuantity(item)).toBe(5)
    expect(getOrderLineFreeBonusQuantity(item)).toBe(0)
    expect(getOrderLineInventoryQuantity(item)).toBe(5)
    expect(hasOrderLineFreeBonus([item])).toBe(false)
  })

  it('adds free bonus to inventory quantity without changing paid quantity', () => {
    const item = { quantity: 5, freeBonusQuantity: 2 }

    expect(getOrderLinePaidQuantity(item)).toBe(5)
    expect(getOrderLineFreeBonusQuantity(item)).toBe(2)
    expect(getOrderLineInventoryQuantity(item)).toBe(7)
    expect(hasOrderLineFreeBonus([item])).toBe(true)
  })

  it('normalizes null and pre-release freeQuantity aliases to zero-safe values', () => {
    expect(getOrderLineFreeBonusQuantity({ quantity: 3, freeBonusQuantity: null })).toBe(0)
    expect(getOrderLineInventoryQuantity({ quantity: 3, freeQuantity: 1 })).toBe(4)
  })
})
