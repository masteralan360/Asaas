export function resolveHintVideoUrl(src: string): string {
    if (/^(https?:|data:|blob:)/.test(src)) return src

    const r2WorkerUrl = import.meta.env.VITE_R2_WORKER_URL?.replace(/\/+$/, '')
    if (!r2WorkerUrl) {
        throw new Error('VITE_R2_WORKER_URL is required to load hint videos from R2.')
    }

    // Accept legacy /tips paths during the transition, but always request the
    // matching object from the R2 bucket's hints prefix.
    const objectName = src.replace(/^\/?(?:tips|hints)\//, '').replace(/^\/+/, '')
    return `${r2WorkerUrl}/hints/${objectName}`
}
