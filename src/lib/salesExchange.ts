import type {
  CurrencyCode,
  ExchangeRateSnapshot,
} from "@/local-db/models";

export interface SalesExchangePayload {
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  base_amount: number;
  quote_amount: number;
  source: string;
  captured_at: string;
  rate_side: "buy" | "sell" | "mid";
  source_price_id: string | null;
  source_price_updated_at: string | null;
}

export interface SalesExchangeRow extends SalesExchangePayload {
  id?: string;
  sale_id?: string;
  workspace_id?: string;
}

const DEFAULT_BASIS_AMOUNT = 100;

function normalizeCurrency(value: string): CurrencyCode | null {
  const currency = value.trim().toLowerCase();
  return currency === "usd" ||
    currency === "eur" ||
    currency === "iqd" ||
    currency === "try"
    ? currency
    : null;
}

export function exchangeSnapshotToPayload(
  snapshot: ExchangeRateSnapshot,
): SalesExchangePayload | null {
  const [baseValue, quoteValue] = snapshot.pair.split("/");
  const baseCurrency = normalizeCurrency(baseValue || "");
  const quoteCurrency = normalizeCurrency(quoteValue || "");
  const quoteAmount = Number(snapshot.rate);
  const baseAmount = Number(snapshot.priceBasisAmount || DEFAULT_BASIS_AMOUNT);

  if (
    !baseCurrency ||
    !quoteCurrency ||
    baseCurrency === quoteCurrency ||
    !Number.isFinite(baseAmount) ||
    baseAmount <= 0 ||
    !Number.isFinite(quoteAmount) ||
    quoteAmount <= 0
  ) {
    return null;
  }

  return {
    base_currency: baseCurrency,
    quote_currency: quoteCurrency,
    base_amount: baseAmount,
    quote_amount: quoteAmount,
    source: snapshot.source || "unknown",
    captured_at: snapshot.timestamp,
    rate_side: snapshot.side || "mid",
    source_price_id: snapshot.priceRowId || null,
    source_price_updated_at: snapshot.priceUpdatedAt || null,
  };
}

export function exchangeSnapshotsToPayloads(
  snapshots: ExchangeRateSnapshot[] | null | undefined,
): SalesExchangePayload[] {
  return (snapshots || [])
    .map(exchangeSnapshotToPayload)
    .filter((row): row is SalesExchangePayload => row !== null);
}

export function salesExchangeRowsToSnapshots(
  rows: readonly unknown[] | null | undefined,
): ExchangeRateSnapshot[] {
  return (rows || []).flatMap((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const baseCurrency = normalizeCurrency(
      String(row.baseCurrency ?? row.base_currency ?? ""),
    );
    const quoteCurrency = normalizeCurrency(
      String(row.quoteCurrency ?? row.quote_currency ?? ""),
    );
    const baseAmount = Number(row.baseAmount ?? row.base_amount ?? 0);
    const quoteAmount = Number(row.quoteAmount ?? row.quote_amount ?? 0);

    if (
      !baseCurrency ||
      !quoteCurrency ||
      baseCurrency === quoteCurrency ||
      !Number.isFinite(baseAmount) ||
      baseAmount <= 0 ||
      !Number.isFinite(quoteAmount) ||
      quoteAmount <= 0
    ) {
      return [];
    }

    const side = String(row.rateSide ?? row.rate_side ?? "mid");
    return [
      {
        pair: `${baseCurrency.toUpperCase()}/${quoteCurrency.toUpperCase()}`,
        rate: quoteAmount,
        source: String(row.source || "unknown"),
        timestamp: String(
          row.capturedAt ?? row.captured_at ?? new Date().toISOString(),
        ),
        side: side === "buy" || side === "sell" ? side : undefined,
        priceBasisAmount: baseAmount,
        priceRowId:
          (row.sourcePriceId ?? row.source_price_id ?? null) as string | null,
        priceUpdatedAt:
          (row.sourcePriceUpdatedAt ??
            row.source_price_updated_at ??
            null) as string | null,
      },
    ];
  });
}
