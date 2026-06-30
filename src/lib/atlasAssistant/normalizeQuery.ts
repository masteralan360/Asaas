import { assistantIntentCatalog } from "./intentCatalog";
import type { AssistantDetection, AssistantLanguage } from "./types";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const PUNCTUATION_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~؟،؛“”‘’]/g;
const RTL_PATTERN = /[\u0620-\u064a\u066e-\u06ef\u06fa-\u06ff]/;

const FOLD_MAP: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ة: "ه",
  ى: "ي",
  ي: "ی",
  ك: "ک",
  ؤ: "و",
  ئ: "ی",
  إێ: "ێ",
};

const KU_HINTS = [
  "داهات",
  "مانگ",
  "ئەم",
  "ئه",
  "پارە",
  "فرۆشتن",
  "کڕین",
  "قازانج",
  "کۆگا",
  "ئەمڕۆ",
  "کڕیار",
  "فرۆشیار",
];

const AR_HINTS = [
  "الإيراد",
  "ايراد",
  "الشهر",
  "اليوم",
  "المبيعات",
  "الربح",
  "المصاريف",
  "المخزون",
  "الفواتير",
];

function foldCharacter(character: string) {
  return FOLD_MAP[character] ?? character;
}

function normalizeDigits(value: string) {
  return Array.from(value).map((character) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(character);
    if (arabicIndex >= 0) return String(arabicIndex);
    const persianIndex = PERSIAN_DIGITS.indexOf(character);
    if (persianIndex >= 0) return String(persianIndex);
    return character;
  }).join("");
}

export function normalizeAssistantQuery(value: string) {
  const folded = Array.from(normalizeDigits(value.trim().toLowerCase()))
    .map(foldCharacter)
    .join("");

  return folded
    .replace(PUNCTUATION_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAssistantLanguage(query: string): AssistantLanguage {
  const normalized = normalizeAssistantQuery(query);
  if (!RTL_PATTERN.test(normalized)) return "en";
  if (KU_HINTS.some((hint) => normalized.includes(normalizeAssistantQuery(hint)))) return "ku";
  if (AR_HINTS.some((hint) => normalized.includes(normalizeAssistantQuery(hint)))) return "ar";
  return "ku";
}

function tokenOverlapScore(query: string, phrase: string) {
  const phraseTokens = normalizeAssistantQuery(phrase).split(" ").filter(Boolean);
  if (phraseTokens.length === 0) return 0;
  const queryTokens = new Set(query.split(" ").filter(Boolean));
  const hits = phraseTokens.filter((token) => queryTokens.has(token) || query.includes(token)).length;
  return hits / phraseTokens.length;
}

function extractPartyEntity(query: string, normalizedQuery: string) {
  const patterns = [
    /\btransactions?\s+for\s+(.+)$/i,
    /\bfor\s+(.+)$/i,
    /\bبۆ\s+(.+)$/,
    /\bل\s+(.+)$/,
    /\bبرای\s+(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = query.trim().match(pattern) || normalizedQuery.match(pattern);
    const value = match?.[1]?.trim();
    if (value && value.length > 1) return value;
  }

  return undefined;
}

export function detectAssistantIntent(query: string): AssistantDetection {
  const language = detectAssistantLanguage(query);
  const normalizedQuery = normalizeAssistantQuery(query);
  let bestIntent = assistantIntentCatalog[0];
  let bestScore = 0;
  let bestSpecificity = 0;

  for (const entry of assistantIntentCatalog) {
    const phrases = [
      ...entry.phrases.en,
      ...entry.phrases.ar,
      ...entry.phrases.ku,
    ];
    let entryScore = 0;
    let entrySpecificity = 0;

    for (const phrase of phrases) {
      const normalizedPhrase = normalizeAssistantQuery(phrase);
      if (!normalizedPhrase) continue;
      const phraseSpecificity = normalizedPhrase.length;
      if (normalizedQuery.includes(normalizedPhrase)) {
        entryScore = Math.max(entryScore, 1);
        entrySpecificity = Math.max(entrySpecificity, phraseSpecificity);
      } else {
        const score = tokenOverlapScore(normalizedQuery, phrase);
        if (score > entryScore || (score === entryScore && phraseSpecificity > entrySpecificity)) {
          entryScore = score;
          entrySpecificity = phraseSpecificity;
        }
      }
    }

    if (entryScore > bestScore || (entryScore === bestScore && entrySpecificity > bestSpecificity)) {
      bestIntent = entry;
      bestScore = entryScore;
      bestSpecificity = entrySpecificity;
    }
  }

  return {
    intentId: bestScore >= 0.55 ? bestIntent.id : null,
    language,
    confidence: Math.round(bestScore * 100) / 100,
    query,
    normalizedQuery,
    entity: bestIntent?.id === "ledger.partyTransactions"
      ? extractPartyEntity(query, normalizedQuery)
      : undefined,
  };
}
