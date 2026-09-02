import { describe, expect, it } from "vitest";

import { settlementNetByShipment } from "./postServiceSettlementNet";

describe("settlementNetByShipment", () => {
  it("adds a received merchant repayment to the post settlement net", () => {
    const net = settlementNetByShipment(
      new Map([["courier-1:iqd", [{ shipmentId: "post-1", amount: 10_000, paid: 10_000, outstanding: 0 }]]]),
      new Map([["merchant-1:iqd", [{ shipmentId: "post-1", amount: 4_000, paid: 4_000, outstanding: 0 }]]]),
      new Map([["merchant-1:iqd", [{ shipmentId: "post-1", amount: 2_750, paid: 2_750, outstanding: 0, direction: "repayment" as const }]]]),
    ).get("post-1");

    expect(net).toEqual({
      courierHandover: 10_000,
      merchantPayout: 4_000,
      merchantRepayment: 2_750,
      hasCourierHandover: true,
      hasMerchantPayout: true,
      hasMerchantRepayment: true,
    });
    expect(net && net.courierHandover + net.merchantRepayment - net.merchantPayout).toBe(8_750);
  });
});
