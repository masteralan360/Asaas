export function resolveHintVideoUrl(src: string): string {
    const base = import.meta.env.BASE_URL ?? '/'
    if (/^(https?:|data:|blob:)/.test(src)) return src
    if (src.startsWith('/')) return `${base.replace(/\/+$/, '')}${src}`
    return `${base}tips/${src}`
}
