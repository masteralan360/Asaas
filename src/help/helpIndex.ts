/**
 * Help Center search index.
 *
 * Each topic bundles a video guide with a rich set of search keywords in
 * every supported language. Queries are normalized (case, diacritics, Arabic
 * letter forms, punctuation) and scored against keywords + localized titles,
 * so users can phrase questions in many ways and still find the video.
 */

export type HelpLanguage = 'en' | 'ar' | 'ku'

export const HELP_LANGUAGES: HelpLanguage[] = ['en', 'ar', 'ku']

export interface HelpTopic {
    id: string
    /** i18n key for the localized title. */
    titleKey: string
    /** i18n key for the localized description. */
    descriptionKey: string
    /** Video file under public/tips, or a full URL. */
    videoSrc: string
    /** Alternative phrasings/wordings users might type, per language. */
    keywords: Record<HelpLanguage, string[]>
}

export const HELP_TOPICS: HelpTopic[] = [
    {
        id: 'adjust-stock',
        titleKey: 'help.topics.adjustStock.title',
        descriptionKey: 'help.topics.adjustStock.description',
        videoSrc: '/tips/export-1785734352530.mp4',
        keywords: {
            en: [
                'how to adjust stock',
                'adjust stock',
                'add stock',
                'stock adjustment',
                'update stock',
                'change stock',
                'increase stock',
                'decrease stock',
                'add quantity',
                'stock quantity',
                'stock level',
                'edit stock',
                'manage stock',
                'product stock',
                'product quantity',
                'initial stock',
                'how to add stock',
                'how to add quantity',
                'how to change stock',
                'add stock to product',
                'adjust product stock',
                'right click add stock',
                'stock in products list',
                'products list add stock',
                'inventory',
                'quantity',
                'stock',
                'product',
                'products',
                'inventory stock',
                'product inventory',
                'store quantity',
                'stock management',
            ],
            ar: [
                'كيفية تعديل المخزون',
                'تعديل المخزون',
                'إضافة مخزون',
                'اضافة مخزون',
                'تعديل الكمية',
                'إضافة كمية',
                'اضافة كمية',
                'كمية المنتج',
                'كمية المخزون',
                'المخزون',
                'الكمية',
                'تغيير المخزون',
                'زيادة المخزون',
                'انقاص المخزون',
                'إنقاص المخزون',
                'إدارة المخزون',
                'ادارة المخزون',
                'إضافة كمية للمنتج',
                'تعديل كمية المنتج',
                'كيف أضيف مخزون',
                'كيف اضيف مخزون',
                'كيف أعدل المخزون',
                'مخزون المنتج',
                'المنتجات',
                'المنتج',
                'إضافة منتج',
                'اضافة منتج',
                'مستودع',
                'الجرد',
                'تسوية المخزون',
            ],
            ku: [
                'چۆن کۆگا زیاد بکەم',
                'گۆڕینی کۆگا',
                'زیادکردنی کۆگا',
                'زیادکردنی بڕ',
                'گۆڕینی بڕ',
                'کۆگا',
                'بڕ',
                'بڕی بەرهەم',
                'کۆگای بەرهەم',
                'بەڕێوەبردنی کۆگا',
                'چۆن بڕ زیاد بکەم',
                'چۆن کۆگا بگۆڕم',
                'بەرهەم',
                'بەرهەمەکان',
                'زیادکردنی بەرهەم',
                'کەرتی بەرهەم',
                'سەرکۆگا',
            ],
        },
    },
    {
        id: 'edit-exchange-rate',
        titleKey: 'help.topics.editExchangeRate.title',
        descriptionKey: 'help.topics.editExchangeRate.description',
        videoSrc: '/tips/export-1785786138786.mp4',
        keywords: {
            en: [
                'how to edit exchange rate',
                'how to edit the exchange rate',
                'edit exchange rate',
                'edit the exchange rate',
                'change exchange rate',
                'update exchange rate',
                'set exchange rate',
                'exchange rate',
                'exchange rate manually',
                'manual exchange rate',
                'manual rate',
                'edit rate manually',
                'how to change exchange rate',
                'how to update exchange rate',
                'how to set exchange rate',
                'how to change the exchange rate',
                'how to add manual rate',
                'set manual rate',
                'manual entry rate',
                'edit currency rate',
                'currency rate',
                'currency exchange rate',
                'usd rate',
                'eur rate',
                'try rate',
                'exchange rate settings',
                'currency settings',
                'rates',
                'rate',
                'exchange',
                'currency',
                'forex',
                'edit rate',
                'change rate',
                'update rate',
            ],
            ar: [
                'تعديل سعر الصرف',
                'تغيير سعر الصرف',
                'تحديث سعر الصرف',
                'ضبط سعر الصرف',
                'سعر الصرف',
                'سعر الصرف اليدوي',
                'تعديل سعر الصرف يدويا',
                'تعديل الصرف يدويا',
                'كيف أعدل سعر الصرف',
                'كيف اعدل سعر الصرف',
                'كيف أغير سعر الصرف',
                'كيف اغير سعر الصرف',
                'كيف أضبط سعر الصرف',
                'سعر صرف يدوي',
                'إضافة سعر صرف يدوي',
                'اضافة سعر صرف يدوي',
                'تعديل الصرف',
                'تغيير الصرف',
                'الصرف',
                'أسعار الصرف',
                'سعر العملة',
                'العملة',
                'عملة',
                'سعر الدولار',
                'سعر اليورو',
                'سعر الليرة',
                'إعدادات سعر الصرف',
                'إعدادات العملة',
                'سعر',
            ],
            ku: [
                'چۆن نرخی ئاڵوگۆڕ دەستکاری بکەم',
                'دەستکاری نرخی ئاڵوگۆڕ',
                'گۆڕینی نرخی ئاڵوگۆڕ',
                'نوێکردنەوەی نرخی ئاڵوگۆڕ',
                'نرخی ئاڵوگۆڕ',
                'نرخی ئاڵوگۆڕ بە دەست',
                'دەستکاری نرخ بە دەست',
                'چۆن نرخی ئاڵوگۆڕ بگۆڕم',
                'چۆن نرخەکە بگۆڕم',
                'نرخی دراو',
                'ئاڵوگۆڕی دراو',
                'ئاڵوگۆڕ',
                'نرخ',
                'نرخی دۆلار',
                'نرخی یۆرۆ',
                'نرخی لیرە',
                'ڕێژەی ئاڵوگۆڕ',
                'دەستکاری دراو',
            ],
        },
    },
]

export interface HelpMatch {
    topic: HelpTopic
    score: number
}

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g
const TAIL_CHARACTERS = /[.,!?;:'"«»“”‘’()[\]{}،؛؟<>|/\\=_+*~$^#@&%`-]+/g

function normalizeText(input: string): string {
    return input
        .toLowerCase()
        .replace(ARABIC_DIACRITICS, '')
        .replace(/[\u0640]/g, '') // tatweel
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ک/g, 'ك')
        .replace(/ی/g, 'ي')
        .replace(/ڵ/g, 'ل')
        .replace(TAIL_CHARACTERS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** True when the query strongly matches a keyword (either contains or is contained by it). */
function keywordMatches(keyword: string, token: string): boolean {
    if (keyword.length >= 2 && token.length >= 2) {
        return keyword.includes(token) || token.includes(keyword)
    }
    return keyword === token
}

const MIN_MATCH_SCORE = 0.3

/**
 * Rank HELP_TOPICS against a free-text query.
 * Keywords from every language participate in matching (so searching in
 * Arabic works even when the UI language is English), but the current
 * language's keywords score highest for phrase-level matches.
 */
export function searchHelp(query: string, language: string): HelpMatch[] {
    const normalizedQuery = normalizeText(query)
    const tokens = normalizedQuery.split(' ').filter((token) => token.length > 0)
    if (tokens.length === 0) return []

    const primaryLanguage: HelpLanguage = (HELP_LANGUAGES as string[]).includes(language)
        ? (language as HelpLanguage)
        : 'en'

    const results: HelpMatch[] = []

    for (const topic of HELP_TOPICS) {
        let bestScore = 0

        const allKeywords = new Set<string>()
        for (const lang of HELP_LANGUAGES) {
            for (const keyword of topic.keywords[lang]) {
                allKeywords.add(normalizeText(keyword))
            }
        }
        const primaryKeywords = topic.keywords[primaryLanguage].map(normalizeText)

        for (const keyword of primaryKeywords) {
            if (normalizedQuery === keyword) {
                bestScore = Math.max(bestScore, 1)
            } else if (normalizedQuery.includes(keyword) || keyword.includes(normalizedQuery)) {
                bestScore = Math.max(bestScore, 0.85)
            }
        }

        let coveredTokens = 0
        for (const token of tokens) {
            let matched = false
            for (const keyword of allKeywords) {
                if (keywordMatches(keyword, token)) {
                    matched = true
                    break
                }
            }
            if (matched) coveredTokens += 1
        }
        const coverage = coveredTokens / tokens.length
        bestScore = Math.max(bestScore, coverage * 0.9)

        if (bestScore >= MIN_MATCH_SCORE) {
            results.push({ topic, score: bestScore })
        }
    }

    results.sort((a, b) => b.score - a.score)
    return results
}
