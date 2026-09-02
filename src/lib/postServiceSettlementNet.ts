import type {
  MerchantAccountSettlementBreakdown,
  ShipmentSettlementBreakdown,
} from "./postServiceSettlementStatus";

export type ShipmentSettlementNet = {
  courierHandover: number;
  merchantPayout: number;
  merchantRepayment: number;
  hasCourierHandover: boolean;
  hasMerchantPayout: boolean;
  hasMerchantRepayment: boolean;
};

/**
 * Combines the FIFO settlement allocations into a per-post cash position.
 * Merchant repayments are incoming cash, so they increase the post's net.
 */
export function settlementNetByShipment(
  courierBreakdownByParty: ReadonlyMap<string, readonly ShipmentSettlementBreakdown[]>,
  merchantBreakdownByParty: ReadonlyMap<string, readonly ShipmentSettlementBreakdown[]>,
  merchantAccountBreakdownByParty: ReadonlyMap<string, readonly MerchantAccountSettlementBreakdown[]>,
) {
  const results = new Map<string, ShipmentSettlementNet>();
  const getOrCreate = (shipmentId: string) => results.get(shipmentId) ?? {
    courierHandover: 0,
    merchantPayout: 0,
    merchantRepayment: 0,
    hasCourierHandover: false,
    hasMerchantPayout: false,
    hasMerchantRepayment: false,
  };

  for (const posts of courierBreakdownByParty.values()) {
    for (const post of posts) {
      if (post.paid <= 0.000001) continue;
      const current = getOrCreate(post.shipmentId);
      current.courierHandover += post.paid;
      current.hasCourierHandover = true;
      results.set(post.shipmentId, current);
    }
  }
  for (const posts of merchantBreakdownByParty.values()) {
    for (const post of posts) {
      if (post.paid <= 0.000001) continue;
      const current = getOrCreate(post.shipmentId);
      current.merchantPayout += post.paid;
      current.hasMerchantPayout = true;
      results.set(post.shipmentId, current);
    }
  }
  for (const posts of merchantAccountBreakdownByParty.values()) {
    for (const post of posts) {
      if (post.direction !== "repayment" || post.paid <= 0.000001) continue;
      const current = getOrCreate(post.shipmentId);
      current.merchantRepayment += post.paid;
      current.hasMerchantRepayment = true;
      results.set(post.shipmentId, current);
    }
  }
  return results;
}
