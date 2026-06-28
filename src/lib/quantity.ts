export const QUANTITY_EPSILON = 0.000001

export function roundQuantity(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(rounded, -0) ? 0 : rounded
}

export function isPositiveQuantity(value: unknown) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > QUANTITY_EPSILON
}

export function isNonNegativeQuantity(value: unknown) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity >= -QUANTITY_EPSILON
}

export function normalizeQuantity(
  value: unknown,
  fieldLabel = 'Quantity',
  options: { allowZero?: boolean } = {}
) {
  const quantity = Number(value)
  const isValid = options.allowZero
    ? Number.isFinite(quantity) && quantity >= -QUANTITY_EPSILON
    : isPositiveQuantity(quantity)

  if (!isValid) {
    throw new Error(
      `${fieldLabel} must be ${options.allowZero ? 'zero or greater' : 'greater than zero'}`
    )
  }

  return roundQuantity(Math.max(quantity, 0))
}

export function quantitiesEqual(left: number, right: number) {
  return Math.abs(roundQuantity(left) - roundQuantity(right)) <= QUANTITY_EPSILON
}
