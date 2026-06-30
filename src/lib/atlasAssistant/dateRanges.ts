export type AssistantDateRangeKey =
  | "today"
  | "this_month"
  | "this_year"
  | "last_month";

export interface AssistantDateRange {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function toRange(start: Date, end: Date): AssistantDateRange {
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getAssistantDateRange(
  key: AssistantDateRangeKey,
  now = new Date(),
): AssistantDateRange {
  if (key === "today") {
    return toRange(startOfDay(now), endOfDay(now));
  }

  if (key === "this_year") {
    return toRange(startOfYear(now), endOfDay(now));
  }

  if (key === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return toRange(start, end);
  }

  return toRange(startOfMonth(now), endOfDay(now));
}

export function isWithinAssistantRange(value: string | null | undefined, range: AssistantDateRange) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= range.start.getTime() && time <= range.end.getTime();
}

export function assistantDayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}
