const RTL_LETTER_PATTERN = /[\u05d0-\u05ea\u0620-\u064a\u066e-\u06ef\u06fa-\u06ff\u0750-\u077f\u0870-\u0887\u0889-\u088f\u08a0-\u08c9\ufb1d-\ufb4f\ufb50-\ufdff\ufe70-\ufefc]/
const LETTER_PATTERN = /\p{L}/u

/**
 * Resolves the base direction from the first strong letter. Text containing
 * only numbers, spaces, and punctuation is deliberately LTR so grouped phone
 * numbers retain the exact order entered inside RTL print layouts.
 */
export function resolveIsolatedTextDirection(text: string): 'ltr' | 'rtl' {
  for (const character of text) {
    if (RTL_LETTER_PATTERN.test(character)) return 'rtl'
    if (LETTER_PATTERN.test(character)) return 'ltr'
  }

  return 'ltr'
}
