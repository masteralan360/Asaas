import { describe, expect, it } from "vitest";

import { assistantIntentCatalog } from "./intentCatalog";
import { detectAssistantIntent, normalizeAssistantQuery } from "./normalizeQuery";

describe("atlas assistant query detection", () => {
  it("routes the English catalog examples to their intended intents", () => {
    assistantIntentCatalog.forEach((entry) => {
      const detection = detectAssistantIntent(entry.phrases.en[0]);
      expect(detection.intentId, entry.id).toBe(entry.id);
    });
  });

  it("routes Arabic and Sorani catalog examples to their intended intents", () => {
    assistantIntentCatalog.forEach((entry) => {
      expect(detectAssistantIntent(entry.phrases.ar[0]).intentId, `${entry.id}:ar`).toBe(entry.id);
      expect(detectAssistantIntent(entry.phrases.ku[0]).intentId, `${entry.id}:ku`).toBe(entry.id);
    });
  });

  it("normalizes Arabic, Kurdish, punctuation, and non-Latin digits", () => {
    expect(normalizeAssistantQuery("أرباح، ١٢٣")).toBe("ارباح 123");
    expect(normalizeAssistantQuery("كڕیار؟ ۱۲۳")).toBe("کڕیار 123");
  });

  it("does not force unsupported questions into an intent", () => {
    const detection = detectAssistantIntent("change the color of the dashboard");
    expect(detection.intentId).toBeNull();
    expect(detection.confidence).toBeLessThan(0.55);
  });
});
