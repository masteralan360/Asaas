const SUPPORTED_LANGS = ['en', 'ar', 'ku']
const RTL_LANGS = new Set(['ar', 'ku', 'ckb'])

export function getSupportedLangs(): string[] {
    return SUPPORTED_LANGS
}

export function getLanguageDirection(lang: string | null | undefined): 'ltr' | 'rtl' {
    const baseLang = lang?.toLowerCase().split(/[-_]/)[0]
    return baseLang && RTL_LANGS.has(baseLang) ? 'rtl' : 'ltr'
}

export function parseLangFromHash(hash: string): { lang: string | null; path: string } {
    const path = hash.replace(/^#/, '').split('?')[0] || '/'
    const match = path.match(/^\/(en|ar|ku)(\/|$)/)
    if (match) {
        return {
            lang: match[1],
            path: '/' + path.slice(match[0].length)
        }
    }
    return { lang: null, path }
}

export function getPathWithLang(path: string, lang: string): string {
    if (!SUPPORTED_LANGS.includes(lang)) return path
    if (path.match(/^\/(en|ar|ku)(\/|$)/)) return path
    return `/${lang}${path === '/' ? '' : path}`
}
