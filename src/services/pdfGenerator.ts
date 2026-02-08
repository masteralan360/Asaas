import { pdf } from '@react-pdf/renderer'
import { A4InvoicePDF } from '@/ui/components/pdf/A4InvoicePDF'
import { ReceiptPDF } from '@/ui/components/pdf/ReceiptPDF'
import { UniversalInvoice } from '@/types'

export type PrintFormat = 'a4' | 'receipt'

interface PDFGeneratorOptions {
    data: UniversalInvoice
    format: PrintFormat
    features: {
        logo_url?: string
        iqd_display_preference?: string
    }
    workspaceName?: string
    translations: {
        // A4 translations
        date: string
        number: string
        soldTo: string
        soldBy: string
        qty: string
        productName: string
        description: string
        price: string
        discount: string
        total: string
        subtotal: string
        terms: string
        exchangeRates: string
        posSystem: string
        generated: string
        // Receipt translations
        id: string
        cashier: string
        paymentMethod: string
        name: string
        quantity: string
        thankYou: string
        keepRecord: string
        snapshots: string
    }
}

/**
 * Generates a PDF blob from invoice data
 */
export async function generateInvoicePdf(options: PDFGeneratorOptions): Promise<Blob> {
    const { data, format, features, workspaceName, translations } = options

    // Pre-process logo: fetch and convert to base64 to avoid react-pdf errors
    // with invalid extensions or CORS issues
    let processedLogoUrl = features.logo_url
    if (processedLogoUrl && (processedLogoUrl.startsWith('http') || processedLogoUrl.startsWith('https'))) {
        try {
            const response = await fetch(processedLogoUrl)
            if (response.ok) {
                const blob = await response.blob()
                processedLogoUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result as string)
                    reader.readAsDataURL(blob)
                })
            } else {
                console.warn('Failed to fetch logo: Response not ok', response.status)
                processedLogoUrl = undefined
            }
        } catch (error) {
            console.warn('Failed to fetch logo for PDF:', error)
            processedLogoUrl = undefined
        }
    }

    let document

    if (format === 'a4') {
        document = A4InvoicePDF({
            data,
            features: {
                ...features,
                logo_url: processedLogoUrl
            },
            translations: {
                date: translations.date,
                number: translations.number,
                soldTo: translations.soldTo,
                soldBy: translations.soldBy,
                qty: translations.qty,
                productName: translations.productName,
                description: translations.description,
                price: translations.price,
                discount: translations.discount,
                total: translations.total,
                subtotal: translations.subtotal,
                terms: translations.terms,
                exchangeRates: translations.exchangeRates,
                posSystem: translations.posSystem,
                generated: translations.generated,
            }
        })
    } else {
        document = ReceiptPDF({
            data,
            features: {
                ...features,
                logo_url: processedLogoUrl
            },
            workspaceName: workspaceName || '',
            translations: {
                date: translations.date,
                id: translations.id,
                cashier: translations.cashier,
                paymentMethod: translations.paymentMethod,
                name: translations.name,
                quantity: translations.quantity,
                price: translations.price,
                total: translations.total,
                thankYou: translations.thankYou,
                keepRecord: translations.keepRecord,
                exchangeRates: translations.exchangeRates,
                snapshots: translations.snapshots,
            }
        })
    }

    const blob = await pdf(document).toBlob()
    return blob
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
