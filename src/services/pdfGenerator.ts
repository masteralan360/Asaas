import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { A4InvoiceTemplate } from '@/ui/components/A4InvoiceTemplate'
import { SaleReceiptBase } from '@/ui/components/SaleReceipt'
import { UniversalInvoice } from '@/types'

export type PrintFormat = 'a4' | 'receipt'

interface PDFGeneratorOptions {
    data: UniversalInvoice
    format: PrintFormat
    features: {
        logo_url?: string | null
        iqd_display_preference?: string
    }
    workspaceName?: string
    translations?: Record<string, string>
}

const A4_WIDTH_MM = 210
const RECEIPT_WIDTH_MM = 80

async function waitForImages(container: HTMLElement) {
    const images = Array.from(container.querySelectorAll('img'))
    await Promise.all(images.map(img => new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
            resolve()
            return
        }
        const cleanup = () => {
            img.removeEventListener('load', cleanup)
            img.removeEventListener('error', cleanup)
            resolve()
        }
        img.addEventListener('load', cleanup)
        img.addEventListener('error', cleanup)
        setTimeout(cleanup, 3000)
    })))
}

async function renderToCanvas(element: ReturnType<typeof createElement>, widthMm: number) {
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.width = `${widthMm}mm`
    container.style.background = '#ffffff'
    container.style.zIndex = '-1'
    container.style.pointerEvents = 'none'
    document.body.appendChild(container)

    const root = createRoot(container)
    root.render(element)

    await new Promise(requestAnimationFrame)
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (document.fonts?.ready) {
        await document.fonts.ready
    }
    await waitForImages(container)

    const scale = Math.min(2, window.devicePixelRatio || 1)
    const canvas = await html2canvas(container, {
        scale,
        useCORS: true,
        backgroundColor: '#ffffff'
    })

    root.unmount()
    container.remove()

    return canvas
}

function canvasToA4Pdf(canvas: HTMLCanvasElement) {
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    const pageHeightPx = Math.floor(canvas.width * (pageHeight / pageWidth))
    let offsetPx = 0
    let pageIndex = 0

    while (offsetPx < canvas.height) {
        const sliceHeight = Math.min(pageHeightPx, canvas.height - offsetPx)
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = sliceHeight

        const ctx = sliceCanvas.getContext('2d')
        if (ctx) {
            ctx.drawImage(canvas, 0, offsetPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)
        }

        const imgData = sliceCanvas.toDataURL('image/png')
        const imgHeightMm = (sliceHeight * pageWidth) / canvas.width

        if (pageIndex > 0) {
            pdf.addPage()
        }

        pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, imgHeightMm)
        offsetPx += pageHeightPx
        pageIndex += 1
    }

    return pdf.output('blob') as Blob
}

function canvasToReceiptPdf(canvas: HTMLCanvasElement) {
    const heightMm = (canvas.height * RECEIPT_WIDTH_MM) / canvas.width
    const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: [RECEIPT_WIDTH_MM, heightMm]
    })

    const imgData = canvas.toDataURL('image/png')
    pdf.addImage(imgData, 'PNG', 0, 0, RECEIPT_WIDTH_MM, heightMm)
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
    const { data, format, features, workspaceName } = options
    const processedLogoUrl = await preprocessLogoUrl(features.logo_url)
    const processedFeatures = {
        ...features,
        logo_url: processedLogoUrl
    }

    if (format === 'receipt') {
        const element = createElement(
            'div',
            { style: { width: `${RECEIPT_WIDTH_MM}mm`, background: '#ffffff' } },
            createElement(SaleReceiptBase, {
                data,
                features: processedFeatures,
                workspaceName: workspaceName || 'Asaas'
            })
        )
        const canvas = await renderToCanvas(element, RECEIPT_WIDTH_MM)
        return canvasToReceiptPdf(canvas)
    }

    const element = createElement(A4InvoiceTemplate, {
        data,
        features: processedFeatures
    })
    const canvas = await renderToCanvas(element, A4_WIDTH_MM)
    return canvasToA4Pdf(canvas)
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
