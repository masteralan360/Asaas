import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

interface PdfPageImageOptions {
    maxWidthPx: number
    pageNumber?: number
}

let isPdfWorkerConfigured = false

function ensurePdfWorkerConfigured() {
    if (isPdfWorkerConfigured) return

    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    isPdfWorkerConfigured = true
}

function resolvePdfRenderScale(pageWidthPx: number, maxWidthPx: number) {
    if (
        !Number.isFinite(pageWidthPx)
        || pageWidthPx <= 0
        || !Number.isFinite(maxWidthPx)
        || maxWidthPx <= 0
    ) {
        return 1
    }

    return maxWidthPx / pageWidthPx
}

export async function renderPdfPageToPngDataUrl(
    pdfBlob: Blob,
    { maxWidthPx, pageNumber = 1 }: PdfPageImageOptions
): Promise<string> {
    ensurePdfWorkerConfigured()

    const pdfData = new Uint8Array(await pdfBlob.arrayBuffer())
    const loadingTask = pdfjsLib.getDocument({ data: pdfData })

    try {
        const pdf = await loadingTask.promise
        const safePageNumber = Math.min(Math.max(1, pageNumber), pdf.numPages)
        const page = await pdf.getPage(safePageNumber)
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = resolvePdfRenderScale(baseViewport.width, maxWidthPx)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const canvasWidth = Math.ceil(viewport.width)
        const canvasHeight = Math.ceil(viewport.height)
        const context = canvas.getContext('2d', { alpha: false })

        if (!context) {
            throw new Error('Unable to create a canvas context for PDF receipt printing.')
        }

        canvas.width = canvasWidth
        canvas.height = canvasHeight
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvasWidth, canvasHeight)

        await page.render({
            canvas,
            viewport,
            background: '#ffffff',
            intent: 'print'
        }).promise

        return canvas.toDataURL('image/png')
    } finally {
        await loadingTask.destroy()
    }
}
