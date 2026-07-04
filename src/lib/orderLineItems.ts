import { roundQuantity } from '@/lib/quantity'

type OrderLineQuantityLike = {
  quantity?: unknown
  freeBonusQuantity?: unknown
  /** @deprecated Pre-release alias; normalize it as a bonus quantity if present. */
  freeQuantity?: unknown
}

function normalizeNonNegativeQuantity(value: unknown) {
  const quantity = Number(value ?? 0)
  return Number.isFinite(quantity)
    ? roundQuantity(Math.max(quantity, 0))
    : 0
}

export function getOrderLinePaidQuantity(item: OrderLineQuantityLike) {
  return normalizeNonNegativeQuantity(item.quantity)
}

export function getOrderLineFreeBonusQuantity(item: OrderLineQuantityLike) {
  return normalizeNonNegativeQuantity(item.freeBonusQuantity ?? item.freeQuantity)
}

export function getOrderLineInventoryQuantity(item: OrderLineQuantityLike) {
  return roundQuantity(getOrderLinePaidQuantity(item) + getOrderLineFreeBonusQuantity(item))
}

export function hasOrderLineFreeBonus(items: OrderLineQuantityLike[] | null | undefined) {
  return Boolean(items?.some((item) => getOrderLineFreeBonusQuantity(item) > 0))
}
