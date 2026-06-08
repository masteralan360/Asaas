import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ar from './locales/ar.json'
import ku from './locales/ku.json'
import { parseLangFromHash } from '@/lib/i18nRouting'

const hash = window.location.hash.replace(/^#/, '') || '/'
const { lang: urlLang } = parseLangFromHash(hash)
const savedLanguage = urlLang || localStorage.getItem('i18nextLng') || 'en'
const direction = savedLanguage === 'ar' || savedLanguage === 'ku' ? 'rtl' : 'ltr'
document.dir = direction
document.documentElement.lang = savedLanguage
document.documentElement.dir = direction

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
