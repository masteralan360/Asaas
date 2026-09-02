import type {
  MerchantAccountSettlementBreakdown,
  ShipmentSettlementBreakdown,
} from "./postServiceSettlementStatus";
import type { DeliveryShipment } from "@/local-db";

export type ShipmentSettlementNet = {
  courierHandover: number;
  courierReimbursement: number;
  merchantPayout: number;
  merchantRepayment: number;
  hasCourierHandover: boolean;
  hasCourierReimbursement: boolean;
  hasMerchantPayout: boolean;
  hasMerchantRepayment: boolean;
};

/** Cash profit for a post after its recorded settlement payments and costs. */
export function shipmentSettlementNetAmount(
  settlementNet: ShipmentSettlementNet,
  workspaceRecipientPayout = 0,
) {
  return settlementNet.courierHandover
    + settlementNet.merchantRepayment
    - settlementNet.merchantPayout
    - settlementNet.courierReimbursement
    - workspaceRecipientPayout;
}

/**
 * Whether all settlement obligations that apply to a post's payment model
 * have been recorded. Prepaid posts settle through repayment/reimbursement,
 * while COD posts settle through courier handover and merchant payout.
 */
export function isShipmentSettlementNetFinalized(
  shipment: Pick<DeliveryShipment, "customerPaymentStatus" | "feePayer" | "deliveryFee" | "recipientPayoutAmount" | "recipientPayoutFunding" | "courierDeliveryFee">,
  settlementNet: ShipmentSettlementNet,
) {
  if (shipment.customerPaymentStatus !== "prepaid_electronically") {
    return settlementNet.hasCourierHandover && settlementNet.hasMerchantPayout;
  }

  const merchantRepaymentExpected = (shipment.feePayer === "merchant" ? shipment.deliveryFee : 0)
    + shipment.recipientPayoutAmount;
  const courierReimbursementExpected = (shipment.courierDeliveryFee ?? 0)
    + ((shipment.recipientPayoutFunding ?? "workspace_payment") === "courier_advance" ? shipment.recipientPayoutAmount : 0);
  return settlementNet.merchantRepayment + 0.000001 >= merchantRepaymentExpected
    && settlementNet.courierReimbursement + 0.000001 >= courierReimbursementExpected;
}

/**
 * Combines the FIFO settlement allocations into a per-post cash position.
 * Merchant repayments are incoming cash, so they increase the post's net.
 */
export function settlementNetByShipment(
  courierBreakdownByParty: ReadonlyMap<string, readonly ShipmentSettlementBreakdown[]>,
  merchantBreakdownByParty: ReadonlyMap<string, readonly ShipmentSettlementBreakdown[]>,
  merchantAccountBreakdownByParty: ReadonlyMap<string, readonly MerchantAccountSettlementBreakdown[]>,
  courierReimbursementPaidByShipment: ReadonlyMap<string, number>,
) {
  const results = new Map<string, ShipmentSettlementNet>();
  const getOrCreate = (shipmentId: string) => results.get(shipmentId) ?? {
    courierHandover: 0,
    courierReimbursement: 0,
    merchantPayout: 0,
    merchantRepayment: 0,
    hasCourierHandover: false,
    hasCourierReimbursement: false,
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
  for (const [shipmentId, amount] of courierReimbursementPaidByShipment) {
    if (amount <= 0.000001) continue;
    const current = getOrCreate(shipmentId);
    current.courierReimbursement += amount;
    current.hasCourierReimbursement = true;
    results.set(shipmentId, current);
  }
  return results;
}
