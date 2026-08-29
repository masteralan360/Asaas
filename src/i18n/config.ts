import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ar from './locales/ar.json'
import ku from './locales/ku.json'
import { getLanguageDirection, parseLangFromHash } from '@/lib/i18nRouting'

// Utility modules also use localized formatters in server-side tooling and
// node-only tests. Derive browser state when it exists, but keep i18n safe to
// import outside a rendered browser document.
const hash = typeof window !== 'undefined'
    ? window.location.hash.replace(/^#/, '') || '/'
    : '/'
const { lang: urlLang } = parseLangFromHash(hash)
const savedLanguage = (typeof localStorage !== 'undefined'
    ? localStorage.getItem('i18nextLng')
    : null) || urlLang || 'en'
const direction = getLanguageDirection(savedLanguage)
if (typeof document !== 'undefined') {
    document.dir = direction
    document.documentElement.lang = savedLanguage
    document.documentElement.dir = direction
}

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            ar: { translation: ar },
            ku: { translation: ku }
        },
        lng: savedLanguage,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false
        },
        react: {
            useSuspense: false
        }
    })

export default i18n
