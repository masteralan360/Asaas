const SUPPORTED_LANGS = ['en', 'ar', 'ku']

export function getSupportedLangs(): string[] {
    return SUPPORTED_LANGS
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
