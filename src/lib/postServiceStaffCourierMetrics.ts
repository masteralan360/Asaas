import type { CurrencyCode, DeliveryBalance } from "@/local-db";

const EPSILON = 0.000001;

export type CourierPayableMetric = {
  agentId: string;
  currency: CurrencyCode;
  amount: number;
};

export type CurrencyAmount = {
  currency: CurrencyCode;
  amount: number;
};

export type StaffCourierObligationMetrics = {
  outstandingCash: CurrencyAmount[];
  courierPayable: CurrencyAmount[];
};

const roundAmount = (amount: number) => Math.round((amount + Number.EPSILON) * 1_000_000) / 1_000_000;

export function summarizeCourierOutstandingCash(
  handoverBalances: ReadonlyArray<DeliveryBalance>,
  courierId?: string,
): CurrencyAmount[] {
  const outstandingByCurrency = new Map<CurrencyCode, number>();
  for (const balance of handoverBalances) {
    if ((courierId && balance.id !== courierId) || balance.amount <= EPSILON) continue;
    outstandingByCurrency.set(balance.currency, (outstandingByCurrency.get(balance.currency) ?? 0) + balance.amount);
  }
  return [...outstandingByCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount: roundAmount(amount) }))
    .filter(({ amount }) => amount > EPSILON)
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function summarizeCourierPayables(
  courierPayables: ReadonlyArray<CourierPayableMetric>,
  courierId?: string,
): CurrencyAmount[] {
  const payableByCurrency = new Map<CurrencyCode, number>();
  for (const payable of courierPayables) {
    if ((courierId && payable.agentId !== courierId) || payable.amount <= EPSILON) continue;
    payableByCurrency.set(payable.currency, (payableByCurrency.get(payable.currency) ?? 0) + payable.amount);
  }
  return [...payableByCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount: roundAmount(amount) }))
    .filter(({ amount }) => amount > EPSILON)
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

/**
 * Keeps a courier's two Post Service obligations independent for the staff
 * dashboard. Outstanding cash is derived from the existing handover
 * breakdown, while courier payables are summed separately by currency.
 */
export function summarizeStaffCourierObligationMetrics(
  courierId: string | null | undefined,
  handoverBalances: ReadonlyArray<DeliveryBalance>,
  courierPayables: ReadonlyArray<CourierPayableMetric>,
): StaffCourierObligationMetrics {
  if (!courierId) return { outstandingCash: [], courierPayable: [] };

  return {
    outstandingCash: summarizeCourierOutstandingCash(handoverBalances, courierId),
    courierPayable: summarizeCourierPayables(courierPayables, courierId),
  };
}
