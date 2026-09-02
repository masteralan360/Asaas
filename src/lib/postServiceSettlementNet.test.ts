import { describe, expect, it } from "vitest";

import { isShipmentSettlementNetFinalized, settlementNetByShipment, shipmentSettlementNetAmount } from "./postServiceSettlementNet";

describe("settlementNetByShipment", () => {
  it("adds a received merchant repayment to the post settlement net", () => {
    const net = settlementNetByShipment(
      new Map([["courier-1:iqd", [{ shipmentId: "post-1", amount: 10_000, paid: 10_000, outstanding: 0 }]]]),
      new Map([["merchant-1:iqd", [{ shipmentId: "post-1", amount: 4_000, paid: 4_000, outstanding: 0 }]]]),
      new Map([["merchant-1:iqd", [{ shipmentId: "post-1", amount: 2_750, paid: 2_750, outstanding: 0, direction: "repayment" as const }]]]),
      new Map(),
    ).get("post-1");

    expect(net).toEqual({
      courierHandover: 10_000,
      courierReimbursement: 0,
      merchantPayout: 4_000,
      merchantRepayment: 2_750,
      hasCourierHandover: true,
      hasCourierReimbursement: false,
      hasMerchantPayout: true,
      hasMerchantRepayment: true,
    });
    expect(net && shipmentSettlementNetAmount(net)).toBe(8_750);
  });

  it("deducts a recorded courier reimbursement from a prepaid post's settlement net", () => {
    const net = settlementNetByShipment(
      new Map(),
      new Map(),
      new Map([["merchant-1:iqd", [{ shipmentId: "post-1", amount: 2_750, paid: 2_750, outstanding: 0, direction: "repayment" as const }]]]),
      new Map([["post-1", 1_750]]),
    ).get("post-1");

    expect(net).toMatchObject({
      courierHandover: 0,
      courierReimbursement: 1_750,
      merchantRepayment: 2_750,
      hasCourierReimbursement: true,
      hasMerchantRepayment: true,
    });
    expect(net && shipmentSettlementNetAmount(net)).toBe(1_000);
    expect(net && isShipmentSettlementNetFinalized({
      customerPaymentStatus: "prepaid_electronically",
      feePayer: "merchant",
      deliveryFee: 2_750,
      recipientPayoutAmount: 0,
      recipientPayoutFunding: "courier_advance",
      courierDeliveryFee: 1_750,
    }, net)).toBe(true);
  });

  it("keeps a prepaid net provisional when either repayment obligation is short", () => {
    const net = {
      courierHandover: 0,
      courierReimbursement: 1_750,
      merchantPayout: 0,
      merchantRepayment: 2_749,
      hasCourierHandover: false,
      hasCourierReimbursement: true,
      hasMerchantPayout: false,
      hasMerchantRepayment: true,
    };

    expect(isShipmentSettlementNetFinalized({
      customerPaymentStatus: "prepaid_electronically",
      feePayer: "merchant",
      deliveryFee: 2_750,
      recipientPayoutAmount: 0,
      recipientPayoutFunding: "courier_advance",
      courierDeliveryFee: 1_750,
    }, net)).toBe(false);
  });
});
