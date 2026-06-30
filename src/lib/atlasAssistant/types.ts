import type { CurrencyCode, IQDDisplayPreference } from "@/local-db";
import type { WorkspacePermissionKey } from "@/permissions";
import type { ModuleFeatureKey } from "@/workspace/WorkspaceContext";

export type AssistantIntentId =
  | "revenue.thisMonth"
  | "revenue.today"
  | "revenue.thisYear"
  | "expenses.thisMonth"
  | "profit.thisMonth"
  | "sales.countToday"
  | "invoices.unpaid"
  | "receivables.total"
  | "payables.total"
  | "customers.topThisMonth"
  | "products.bestSellingThisMonth"
  | "stock.low"
  | "stock.value"
  | "sales.byDayThisMonth"
  | "sales.byBranchThisMonth"
  | "purchases.thisMonth"
  | "invoices.overdue"
  | "ledger.cashReceivedToday"
  | "ledger.paidToday"
  | "metrics.compareMonth"
  | "ledger.today"
  | "ledger.moneyInToday"
  | "ledger.moneyOutToday"
  | "ledger.partyTransactions"
  | "ledger.byPaymentMethodThisMonth";

export type AssistantLanguage = "en" | "ar" | "ku";

export type AssistantAnswerStatus =
  | "answered"
  | "needs_clarification"
  | "unsupported"
  | "no_access"
  | "no_data"
  | "error";

export interface AssistantMetric {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "warning";
}

export interface AssistantAnswerRow {
  id: string;
  label: string;
  value: string;
  detail?: string;
  routePath?: string;
}

export interface AssistantAnswer {
  status: AssistantAnswerStatus;
  intentId?: AssistantIntentId;
  language: AssistantLanguage;
  title: string;
  summary: string;
  metrics?: AssistantMetric[];
  rows?: AssistantAnswerRow[];
  routePath?: string;
  confidence: number;
}

export interface AssistantCatalogEntry {
  id: AssistantIntentId;
  module: string;
  requiredFeature?: ModuleFeatureKey;
  requiredPermissions?: WorkspacePermissionKey[];
  phrases: Record<AssistantLanguage, string[]>;
  handler: AssistantIntentId;
}

export interface AssistantRates {
  usd_iqd: number;
  eur_iqd: number;
  try_iqd: number;
}

export interface AssistantAccessContext {
  hasFeature: (feature: ModuleFeatureKey) => boolean;
  hasPermission: (permission: WorkspacePermissionKey) => boolean;
}

export interface AssistantAnswerContext extends AssistantAccessContext {
  workspaceId: string;
  defaultCurrency: CurrencyCode;
  iqdDisplayPreference: IQDDisplayPreference;
  rates?: AssistantRates;
  now?: Date;
}

export interface AssistantDetection {
  intentId: AssistantIntentId | null;
  language: AssistantLanguage;
  confidence: number;
  query: string;
  normalizedQuery: string;
  entity?: string;
}

export type AssistantSpeechStatusCode =
  | "placeholder_unavailable"
  | "kurdishtts_website_available"
  | "kurdishtts_website_unavailable"
  | "desktop_only"
  | "microphone_unavailable"
  | "error";

export interface AssistantSpeechAvailability {
  available: boolean;
  status: AssistantSpeechStatusCode;
  message: string;
}

export interface AssistantSpeechTranscript {
  transcript: string;
  language?: AssistantLanguage;
  confidence?: number | null;
  durationMs?: number | null;
}

export interface AssistantSpeechAdapter {
  isAvailable: () => boolean;
  getAvailability: (forceRefresh?: boolean) => Promise<AssistantSpeechAvailability>;
  startDictation: () => Promise<AssistantSpeechTranscript>;
  stopDictation?: () => boolean;
}
