export interface PdfProgressReport {
    fraction: number
    stageKey: string
    page?: number
    total?: number
}

type PdfProgressListener = (report: PdfProgressReport) => void

const listeners = new Set<PdfProgressListener>()

export function subscribePdfProgress(listener: PdfProgressListener) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function reportPdfProgress(fraction: number, stageKey: string, extra?: { page?: number, total?: number }) {
    const clamped = Math.min(1, Math.max(0, fraction))
    const report: PdfProgressReport = { fraction: clamped, stageKey, ...extra }
    listeners.forEach((listener) => listener(report))
}
