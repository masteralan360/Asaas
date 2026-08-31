import { describe, expect, it } from "vitest";

import type { DeliveryBalance } from "@/local-db";

import { summarizeCourierOutstandingCash, summarizeCourierPayables, summarizeStaffCourierObligationMetrics, type CourierPayableMetric } from "./postServiceStaffCourierMetrics";

const handover = (id: string, amount: number, currency: DeliveryBalance["currency"] = "iqd"): DeliveryBalance => ({ id, amount, currency, paid: 0 });
const payable = (agentId: string, amount: number, currency: CourierPayableMetric["currency"] = "iqd"): CourierPayableMetric => ({ agentId, amount, currency });

describe("summarizeStaffCourierObligationMetrics", () => {
  it("keeps the courier's outstanding handover and payable amounts separate", () => {
    const result = summarizeStaffCourierObligationMetrics(
      "courier-1",
      [handover("courier-1", 15_000), handover("courier-2", 50_000)],
      [payable("courier-1", 10_000), payable("courier-2", 25_000)],
    );

    expect(result).toEqual({
      outstandingCash: [{ currency: "iqd", amount: 15_000 }],
      courierPayable: [{ currency: "iqd", amount: 10_000 }],
    });
  });

  it("totals payables only within each currency and rounds decimal sums", () => {
    const result = summarizeStaffCourierObligationMetrics(
      "courier-1",
      [handover("courier-1", 100, "usd"), handover("courier-1", 20_000, "iqd")],
      [payable("courier-1", 0.1, "usd"), payable("courier-1", 0.2, "usd"), payable("courier-1", 5_000, "iqd")],
    );

    expect(result).toEqual({
      outstandingCash: [{ currency: "iqd", amount: 20_000 }, { currency: "usd", amount: 100 }],
      courierPayable: [{ currency: "iqd", amount: 5_000 }, { currency: "usd", amount: 0.3 }],
    });
  });

  it("returns no metrics when the user is not linked to a courier", () => {
    expect(summarizeStaffCourierObligationMetrics(null, [handover("courier-1", 15_000)], [payable("courier-1", 10_000)])).toEqual({
      outstandingCash: [],
      courierPayable: [],
    });
  });

  it("keeps all-courier handovers and payables separate for the admin metrics", () => {
    const handovers = [handover("courier-1", 45_000), handover("courier-2", 15_000)];
    const payables = [payable("courier-1", 11_750), payable("courier-2", 10_000)];

    expect(summarizeCourierOutstandingCash(handovers)).toEqual([{ currency: "iqd", amount: 60_000 }]);
    expect(summarizeCourierPayables(payables)).toEqual([{ currency: "iqd", amount: 21_750 }]);
  });
});
