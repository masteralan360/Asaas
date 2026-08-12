import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from '@/i18n/config'
import { I18nextProvider } from 'react-i18next'
import { A4InvoiceTemplate, ModernA4InvoiceTemplate, ProfessionalA4InvoiceTemplate, RefundA4InvoiceTemplate, RefundPrimaryA4InvoiceTemplate } from '@/ui/components'
import { SaleReceiptBase } from '@/ui/components/SaleReceipt'
import { UniversalInvoice } from '@/types'
import {
    A4_PAGE_HEIGHT_MM,
    getA4PageStarts,
    type A4KeepTogetherBlock
} from '@/services/a4Pagination'
import { paginateOrderItemsStatementPages, paginateOrderItemsTables } from '@/lib/orderItemsTablePagination'
import { centerTablesOnPages } from '@/lib/centeredTablePagination'
import { reportPdfProgress } from '@/services/pdfProgress'
import { isTauri } from '@/lib/platform'
import { platformService } from '@/services/platformService'

/** Formats that can be stored as invoice versions. */
export type InvoicePrintFormat = 'a4' | 'receipt'

/**
 * Formats available from the common print selector. Barcode labels are
 * printable documents, but never invoice versions.
 */
export type PrintFormat = InvoicePrintFormat | 'barcode_35x15'

export function isInvoicePrintFormat(format: PrintFormat): format is InvoicePrintFormat {
    return format === 'a4' || format === 'receipt'
}

interface RenderResult {
    background: HTMLCanvasElement
    widthMm: number
    heightMm: number
    keepTogetherBlocks: A4KeepTogetherBlock[]
}

type JsPDFConstructor = typeof import('jspdf').jsPDF

interface WorkspaceContactPair {
    primary?: string
    nonPrimary?: string
}

interface WorkspaceFooterContacts {
    address?: WorkspaceContactPair
    email?: WorkspaceContactPair
    phone?: WorkspaceContactPair
}

interface PDFGeneratorOptions {
    data: UniversalInvoice
    format: PrintFormat
    features: {
        logo_url?: string | null
        iqd_display_preference?: string
        print_lang?: string
        a4_template?: string
    }
    workspaceName?: string
    workspaceId?: string
    translations?: Record<string, string>
    workspaceFooterContacts?: WorkspaceFooterContacts
}

interface TemplatePdfOptions {
    element: ReactElement
    format?: PrintFormat
    printLang?: string
}

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = A4_PAGE_HEIGHT_MM
const RECEIPT_WIDTH_MM = 80
const RENDER_SCALE = 2.5
// html-to-image needs a valid data URL when an image cannot be downloaded.
// An empty source makes its cloned <img> emit an error event, which rejects
// the entire PDF render. This transparent GIF preserves the image's layout
// without putting an unreadable third-party image in the canvas.
const TRANSPARENT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function resolvePrintLanguage(printLang: string | null | undefined) {
    return printLang && printLang !== 'auto' ? printLang : i18n.language
}

async function waitForImageReady(image: HTMLImageElement, timeoutMs = 10_000) {
    await new Promise<void>((resolve) => {
        if (image.complete) {
            resolve()
            return
        }

        const cleanup = () => {
            image.removeEventListener('load', cleanup)
            image.removeEventListener('error', cleanup)
            resolve()
        }

        image.addEventListener('load', cleanup)
        image.addEventListener('error', cleanup)
        setTimeout(cleanup, timeoutMs)
    })

    // iOS WebKit can fire `load` before the image is fully decoded. Waiting for
    // decode prevents html-to-image from capturing an empty custom-template image.
    if (image.naturalWidth > 0 && typeof image.decode === 'function') {
        await Promise.race([
            image.decode().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
        ])
    }
}

async function waitForImages(container: HTMLElement) {
    await Promise.all(Array.from(container.querySelectorAll('img')).map((image) => waitForImageReady(image)))
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error || new Error('Failed to read image data.'))
        reader.readAsDataURL(blob)
    })
}

const TAURI_ASSET_PREFIXES = [
    'asset://localhost/',
    'https://asset.localhost/',
    'http://localhost/'
]

/**
 * Extracts the filesystem path from a Tauri asset-protocol URL produced by
 * `convertFileSrc` (for example `asset://localhost/attached-images/...` on
 * iOS and `https://asset.localhost/C:/Users/...` on desktop).
 */
function extractTauriAssetFsPath(source: string): string | null {
    for (const prefix of TAURI_ASSET_PREFIXES) {
        if (!source.startsWith(prefix)) continue

        let filePath = decodeURIComponent(source.slice(prefix.length))
        if (/^\/[A-Za-z]:[\\/]/.test(filePath)) {
            filePath = filePath.slice(1)
        }
        return filePath || null
    }
    return null
}

function imageMimeFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    return 'application/octet-stream'
}

async function inlineCaptureableImages(container: HTMLElement) {
    const images = Array.from(container.querySelectorAll('img'))

    await Promise.all(images.map(async (image) => {
        const source = image.currentSrc || image.src
        if (!source || source.startsWith('data:')) {
            return
        }

        // Tauri asset-protocol URLs (asset://localhost/... on iOS,
        // https://asset.localhost/... on desktop) cannot be fetched from the
        // webview, so html-to-image cannot embed them in its SVG foreignObject
        // clone and they silently vanish from the captured canvas on iOS
        // WebKit. Read the file through the fs plugin and inline it as a data
        // URL before capture.
        const tauriFilePath = isTauri() ? extractTauriAssetFsPath(source) : null
        if (tauriFilePath) {
            try {
                const bytes = await platformService.readFile(tauriFilePath)
                image.src = await blobToDataUrl(new Blob([bytes], { type: imageMimeFromPath(tauriFilePath) }))
                await waitForImageReady(image)
            } catch (error) {
                console.warn('[pdfGenerator] Failed to inline Tauri asset image:', tauriFilePath, error)
            }
            return
        }

        // Remote images are embedded by html-to-image during capture. Its
        // placeholder option below makes a CORS-blocked image empty instead of
        // allowing the image error event to abort the complete PDF generation.
    }))
}

async function expandContainerToRenderedBounds(container: HTMLElement) {
    await new Promise(requestAnimationFrame)

    const containerRect = container.getBoundingClientRect()
    let maxBottomPx = Math.max(container.scrollHeight, container.offsetHeight)

    container.querySelectorAll<HTMLElement>('*').forEach((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 && rect.height <= 0) return

        const bottomPx = rect.bottom - containerRect.top
        if (Number.isFinite(bottomPx)) {
            maxBottomPx = Math.max(maxBottomPx, bottomPx)
        }
    })

    if (maxBottomPx > container.offsetHeight) {
        container.style.minHeight = `${Math.ceil(maxBottomPx)}px`
        await new Promise(requestAnimationFrame)
    }
}

async function reflowTemplateTextAfterContent(container: HTMLElement, widthMm: number) {
    const anchor = container.querySelector<HTMLElement>('[data-template-text-flow-anchor]')
    if (!anchor) return

    const containerRect = container.getBoundingClientRect()
    if (containerRect.width <= 0) return

    const anchorRect = anchor.getBoundingClientRect()
    const millimetersPerPixel = widthMm / containerRect.width
    const contentBottomMm = (anchorRect.bottom - containerRect.top) * millimetersPerPixel
    if (!Number.isFinite(contentBottomMm)) return

    container.querySelectorAll<HTMLElement>('[data-template-text-flow="after-content"]').forEach((text) => {
        const savedY = Number(text.dataset.templateTextYMm)
        if (!Number.isFinite(savedY)) return

        text.style.top = `${Math.max(savedY, contentBottomMm + 1)}mm`
    })

    await new Promise(requestAnimationFrame)
}

function collectA4KeepTogetherBlocks(container: HTMLElement, widthMm: number): A4KeepTogetherBlock[] {
    if (widthMm !== A4_WIDTH_MM) return []

    const containerRect = container.getBoundingClientRect()
    if (containerRect.width <= 0) return []

    const pxToMm = widthMm / containerRect.width
    const candidates = new Set([
        ...container.querySelectorAll<HTMLElement>(
            '[data-pdf-keep-together], [data-qr-sharp="true"], table, tr, .break-inside-avoid, .page-break-inside-avoid'
        )
    ])

    return Array.from(candidates).flatMap((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return []

        const topMm = (rect.top - containerRect.top) * pxToMm
        const bottomMm = (rect.bottom - containerRect.top) * pxToMm
        return Number.isFinite(topMm) && Number.isFinite(bottomMm)
            ? [{ topMm, bottomMm }]
            : []
    })
}

function createCanvasSlice(
    source: HTMLCanvasElement,
    sourceHeightMm: number,
    pageStartMm: number,
    pageEndMm: number
) {
    const topPx = Math.max(0, Math.floor((pageStartMm / sourceHeightMm) * source.height))
    const bottomPx = Math.min(source.height, Math.ceil((pageEndMm / sourceHeightMm) * source.height))
    const slice = document.createElement('canvas')
    slice.width = source.width
    slice.height = Math.max(1, bottomPx - topPx)
    slice.getContext('2d')?.drawImage(
        source,
        0,
        topPx,
        source.width,
        slice.height,
        0,
        0,
        source.width,
        slice.height
    )
    return slice
}

/**
 * Captures a rendered print template to canvas with html-to-image (SVG
 * foreignObject), allowing the browser to paint the clone consistently across
 * desktop, Android, and iOS/iPadOS.
 */
async function renderToCanvas(element: ReturnType<typeof createElement>, widthMm: number): Promise<RenderResult> {
    const container = document.createElement('div')
    container.id = 'pdf-render-container'
    // Must live in the viewport: html-to-image clones the node with its
    // computed style, and Chromium does not paint `position: fixed` (or
    // offscreen) content inside the SVG foreignObject — the capture comes
    // out blank. A top-left, invisible (opacity 0) absolute container is
    // painted correctly; the clone's opacity is restored via the style
    // override below.
    container.style.position = 'absolute'
    container.style.left = '0'
    container.style.top = '0'
    container.style.width = `${widthMm}mm`
    container.style.background = '#ffffff'
    container.style.zIndex = '-9999'
    container.style.pointerEvents = 'none'
    container.style.opacity = '0'
    // Rely on index.css @media print for hiding, as display:none breaks canvas capture
    container.classList.add('no-print')
    document.body.appendChild(container)

    const root = createRoot(container)
    root.render(element)

    await new Promise(requestAnimationFrame)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (document.fonts?.ready) {
        await document.fonts.ready
    }
    await waitForImages(container)
    await inlineCaptureableImages(container)
    await reflowTemplateTextAfterContent(container, widthMm)
    await expandContainerToRenderedBounds(container)
    reportPdfProgress(0.1, 'print.progressPreparing')

    if (widthMm === A4_WIDTH_MM) {
        // Pack complete orders into whole A4 pages (statement templates only),
        // then cut any oversized single-order table exactly at the A4 red line
        // and give each continuation chunk its own title and column header row.
        paginateOrderItemsStatementPages(container, {
            pageHeightMm: A4_HEIGHT_MM,
            pageWidthMm: widthMm
        })
        await expandContainerToRenderedBounds(container)
        paginateOrderItemsTables(container, {
            pageHeightMm: A4_HEIGHT_MM,
            pageWidthMm: widthMm
        })
        await expandContainerToRenderedBounds(container)
        // Vertically center continuation tables (for example the Atlas Standard
        // order invoice's follow-up tables) on their own A4 page.
        centerTablesOnPages(container, {
            pageHeightMm: A4_HEIGHT_MM,
            pageWidthMm: widthMm
        })
        await expandContainerToRenderedBounds(container)
        reportPdfProgress(0.25, 'print.progressLayingOut')
    }

    const keepTogetherBlocks = collectA4KeepTogetherBlocks(container, widthMm)

    // The container is invisible (opacity 0) while it lives in the viewport;
    // restore the clone's opacity so the SVG foreignObject paints it.
    reportPdfProgress(0.4, 'print.progressRendering')
    const { toCanvas } = await import('html-to-image')
    const background = await toCanvas(container, {
        pixelRatio: RENDER_SCALE,
        backgroundColor: '#ffffff',
        // Product image providers such as Google thumbnails use a shared path
        // and identify the actual image entirely through query parameters.
        // html-to-image otherwise drops those parameters from its cache key,
        // causing a previously downloaded product photo to be reused for
        // different rows in the same PDF.
        includeQueryParams: true,
        imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
        style: { opacity: '1' }
    })
    reportPdfProgress(0.6, 'print.progressRendering')

    const containerPixelWidth = container.offsetWidth
    const pxToMm = widthMm / containerPixelWidth

    root.unmount()
    container.remove()

    return {
        background,
        widthMm,
        heightMm: (background.height * pxToMm) / RENDER_SCALE,
        keepTogetherBlocks
    }
}

function canvasToA4Pdf(renderResult: RenderResult, PdfDocument: JsPDFConstructor) {
    const pdf = new PdfDocument({ orientation: 'p', unit: 'mm', format: 'a4' })
    const pageStarts = getA4PageStarts(renderResult.heightMm, renderResult.keepTogetherBlocks, A4_HEIGHT_MM)

    for (let pageIndex = 0; pageIndex < pageStarts.length; pageIndex += 1) {
        reportPdfProgress(
            0.65 + (0.3 * (pageIndex + 1)) / pageStarts.length,
            'print.progressBuildingPdf',
            { page: pageIndex + 1, total: pageStarts.length }
        )

        if (pageIndex > 0) {
            pdf.addPage('a4', 'p')
        }

        const pageOffset = pageStarts[pageIndex]
        const pageEnd = pageStarts[pageIndex + 1] || renderResult.heightMm
        const pageContentHeight = pageEnd - pageOffset
        pdf.addImage(
            createCanvasSlice(renderResult.background, renderResult.heightMm, pageOffset, pageEnd),
            'JPEG',
            0,
            0,
            renderResult.widthMm,
            pageContentHeight,
            undefined,
            'FAST'
        )
    }

    return pdf.output('blob') as Blob
}

function canvasToReceiptPdf(renderResult: RenderResult, PdfDocument: JsPDFConstructor) {
    const pdf = new PdfDocument({
        orientation: 'p',
        unit: 'mm',
        format: [renderResult.widthMm, renderResult.heightMm]
    })

    reportPdfProgress(0.95, 'print.progressBuildingPdf', { page: 1, total: 1 })

    // Add background JPEG
    pdf.addImage(renderResult.background, 'JPEG', 0, 0, renderResult.widthMm, renderResult.heightMm, undefined, 'FAST')

    return pdf.output('blob') as Blob
}

async function preprocessLogoUrl(logoUrl?: string | null) {
    if (!logoUrl || !(logoUrl.startsWith('http') || logoUrl.startsWith('https'))) {
        return logoUrl
    }

    try {
        const response = await fetch(logoUrl)
        if (!response.ok) return undefined
        const blob = await response.blob()
        return await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
        })
    } catch (error) {
        console.warn('Failed to fetch logo for PDF:', error)
        return undefined
    }
}

/**
 * Generates a PDF blob from invoice data using the HTML templates.
 */
export async function generateInvoicePdf(options: PDFGeneratorOptions): Promise<Blob> {
    const { data, format, features = {} as any, workspaceName, workspaceId, workspaceFooterContacts } = options

    // Inject workspaceId into data for QR codes
    if (workspaceId && !data.workspaceId) {
        data.workspaceId = workspaceId
    }

    // Ensure i18n is initialized to prevent raw keys appearing in PDF
    if (!i18n.isInitialized) {
        await new Promise(resolve => i18n.on('initialized', resolve))
    }

    // Create a fixed instance for the specific print language
    const targetLang = resolvePrintLanguage(features?.print_lang)
    const pdfI18n = i18n.cloneInstance({ lng: targetLang })
    await pdfI18n.changeLanguage(targetLang)

    const processedLogoUrl = await preprocessLogoUrl(features?.logo_url)
    const processedFeatures = {
        ...features,
        print_lang: targetLang,
        logo_url: processedLogoUrl
    }

    // Set direction explicitly for the rendering process based on current print selection
    // though templates handle it, this helps the canvas capture detect context better
    const isRTL = targetLang === 'ar' || targetLang === 'ku'

    if (format === 'receipt') {
        const element = createElement(
            'div',
            {
                style: { width: `${RECEIPT_WIDTH_MM}mm`, background: '#ffffff' },
                dir: isRTL ? 'rtl' : 'ltr'
            },
            createElement(
                I18nextProvider,
                { i18n: pdfI18n },
                createElement(SaleReceiptBase, {
                    data,
                    features: processedFeatures,
                    workspaceName: workspaceName || workspaceId || 'Atlas',
                    workspaceId: workspaceId || ''
                })
            )
        )
        const renderResult = await renderToCanvas(element, RECEIPT_WIDTH_MM)
        const { jsPDF } = await import('jspdf')
        return canvasToReceiptPdf(renderResult, jsPDF)
    }

    const isRefundA4 = !!data.is_refund_invoice
    const isModernA4 = features?.a4_template === 'modern'
    const isProfessionalA4 = features?.a4_template === 'professional'
    const element = createElement(
        I18nextProvider,
        { i18n: pdfI18n },
        isRefundA4
            ? (isModernA4
                ? createElement(RefundA4InvoiceTemplate, {
                    data,
                    features: processedFeatures,
                    workspaceId,
                    workspaceName: workspaceName || workspaceId || 'Atlas'
                })
                : createElement(RefundPrimaryA4InvoiceTemplate, {
                    data,
                    features: processedFeatures,
                    workspaceId,
                    workspaceName: workspaceName || workspaceId || 'Atlas',
                    workspaceFooterContacts
                }))
            : isProfessionalA4
            ? createElement(ProfessionalA4InvoiceTemplate, {
                data,
                features: processedFeatures,
                workspaceId,
                workspaceName: workspaceName || workspaceId || 'Atlas',
                workspaceFooterContacts
            })
            : isModernA4
            ? createElement(ModernA4InvoiceTemplate, {
                data,
                features: processedFeatures,
                workspaceId,
                workspaceName: workspaceName || workspaceId || 'Atlas',
                workspaceFooterContacts
            })
            : createElement(A4InvoiceTemplate, {
                data,
                features: processedFeatures,
                workspaceId,
                workspaceName: workspaceName || workspaceId || 'Atlas',
                workspaceFooterContacts
            })
    )
    const renderResult = await renderToCanvas(element, A4_WIDTH_MM)
    const { jsPDF } = await import('jspdf')
    return canvasToA4Pdf(renderResult, jsPDF)

}

/**
 * Generates a PDF blob from a custom React element (e.g., Loan print templates).
 */
export async function generateTemplatePdf({
    element,
    format = 'a4',
    printLang,
}: TemplatePdfOptions): Promise<Blob> {
    if (!i18n.isInitialized) {
        await new Promise(resolve => i18n.on('initialized', resolve))
    }

    const targetLang = resolvePrintLanguage(printLang)
    const pdfI18n = i18n.cloneInstance({ lng: targetLang })
    await pdfI18n.changeLanguage(targetLang)

    const wrappedElement = createElement(I18nextProvider, { i18n: pdfI18n }, element)

    const widthMm = format === 'receipt' ? RECEIPT_WIDTH_MM : A4_WIDTH_MM
    const renderResult = await renderToCanvas(wrappedElement, widthMm)
    const { jsPDF } = await import('jspdf')

    return format === 'receipt' ? canvasToReceiptPdf(renderResult, jsPDF) : canvasToA4Pdf(renderResult, jsPDF)
}

/**
 * Generates R2 path for invoice PDF
 */
export function getInvoicePdfR2Path(
    workspaceId: string,
    invoiceId: string,
    format: PrintFormat
): string {
    const folder = format === 'a4' ? 'A4' : 'receipts'
    return `${workspaceId}/printed-invoices/${folder}/${invoiceId}.pdf`
}

/**
 * Downloads a PDF blob to user's device
 */
export function downloadPdfBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
