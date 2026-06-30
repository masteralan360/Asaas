import { formatCurrency } from "@/lib/utils";
import type { CurrencyCode, IQDDisplayPreference } from "@/local-db";
import type { AssistantLanguage } from "./types";

const EMPTY_DASH = "-";

export function formatAssistantCurrency(
  value: number,
  currency: CurrencyCode,
  iqdDisplayPreference: IQDDisplayPreference,
) {
  return formatCurrency(
    Math.round(value * 100) / 100,
    currency,
    iqdDisplayPreference,
  );
}

export function formatAssistantNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function localizeAssistantText(
  language: AssistantLanguage,
  values: { en: string; ar: string; ku: string },
) {
  return values[language] || values.en;
}

export function formatPercentChange(value: number) {
  if (!Number.isFinite(value)) return EMPTY_DASH;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
