import { describe, expect, it } from "vitest";

import {
  exchangeSnapshotsToPayloads,
  salesExchangeRowsToSnapshots,
} from "./salesExchange";
import { convertCurrencyAmountWithSnapshot } from "./orderCurrency";

describe("sales exchange normalization", () => {
  it("converts an exchange snapshot into typed storage columns", () => {
    expect(
      exchangeSnapshotsToPayloads([
        {
          pair: "USD/IQD",
          rate: 145000,
          source: "manual",
          timestamp: "2026-06-14T10:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        base_currency: "usd",
        quote_currency: "iqd",
        base_amount: 100,
        quote_amount: 145000,
        source: "manual",
        captured_at: "2026-06-14T10:00:00.000Z",
        rate_side: "mid",
        source_price_id: null,
        source_price_updated_at: null,
      },
    ]);
  });

  it("reconstructs the receipt snapshot shape from relation rows", () => {
    expect(
      salesExchangeRowsToSnapshots([
        {
          base_currency: "eur",
          quote_currency: "iqd",
          base_amount: 100,
          quote_amount: 160000,
          source: "forexfy",
          captured_at: "2026-06-14T10:00:00.000Z",
          rate_side: "sell",
          source_price_id: null,
          source_price_updated_at: null,
        },
      ]),
    ).toEqual([
      {
        pair: "EUR/IQD",
        rate: 160000,
        source: "forexfy",
        timestamp: "2026-06-14T10:00:00.000Z",
        side: "sell",
        priceBasisAmount: 100,
        priceRowId: null,
        priceUpdatedAt: null,
      },
    ]);
  });

  it("rejects invalid or same-currency pairs", () => {
    expect(
      exchangeSnapshotsToPayloads([
        {
          pair: "USD/USD",
          rate: 100,
          source: "manual",
          timestamp: "2026-06-14T10:00:00.000Z",
        },
      ]),
    ).toEqual([]);
  });

  it("uses the stored basis amount when converting currency", () => {
    expect(
      convertCurrencyAmountWithSnapshot(2, "usd", "iqd", [
        {
          pair: "USD/IQD",
          rate: 145000,
          source: "manual",
          timestamp: "2026-06-14T10:00:00.000Z",
          priceBasisAmount: 100,
        },
      ]),
    ).toBe(2900);
  });
});
