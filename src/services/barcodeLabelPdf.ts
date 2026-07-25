import { getCode128BBarWidths, formatBarcodeLabelPrice, type BarcodeLabelData } from '@/lib/barcodeLabel'

export const BARCODE_LABEL_WIDTH_MM = 35
export const BARCODE_LABEL_HEIGHT_MM = 15

type BarcodeLabelsPdfOptions = {
    labels: BarcodeLabelData[]
    showPrice?: boolean
}

const ARABIC_FONT_FILE = 'NotoKufiArabic-Regular.ttf'
const ARABIC_FONT_FAMILY = 'NotoKufiArabic'
let arabicFontDataPromise: Promise<string | null> | null = null

async function getArabicFontData() {
    if (!arabicFontDataPromise) {
        arabicFontDataPromise = fetch('/fonts/NotoKufiArabic-Regular.ttf')
            .then(async (response) => {
                if (!response.ok) return null

                const bytes = new Uint8Array(await response.arrayBuffer())
                let binary = ''
                const chunkSize = 0x8000
                for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
                }
                return btoa(binary)
            })
            .catch(() => null)
    }

    return arabicFontDataPromise
}

async function registerArabicFont(pdf: import('jspdf').jsPDF) {
    const fontData = await getArabicFontData()
    if (!fontData) return false

    pdf.addFileToVFS(ARABIC_FONT_FILE, fontData)
    pdf.addFont(ARABIC_FONT_FILE, ARABIC_FONT_FAMILY, 'normal')
    return true
}

function fitText(pdf: import('jspdf').jsPDF, value: string, maxWidth: number, startingSize: number, minimumSize: number) {
    let size = startingSize
    pdf.setFontSize(size)

    while (size > minimumSize && pdf.getTextWidth(value) > maxWidth) {
        size = Math.max(minimumSize, size - 0.15)
        pdf.setFontSize(size)
    }

    return size
}

function drawBarcode(pdf: import('jspdf').jsPDF, value: string, x: number, y: number, width: number, height: number) {
    const widths = getCode128BBarWidths(value)
    const totalModules = widths.reduce((total, barWidth) => total + barWidth, 0)
    const moduleWidth = width / totalModules
    let cursor = x

    widths.forEach((barWidth, index) => {
        const renderedWidth = barWidth * moduleWidth
        if (index % 2 === 0) {
            pdf.rect(cursor, y, renderedWidth, height, 'F')
        }
        cursor += renderedWidth
    })
}

function drawLabel(
    pdf: import('jspdf').jsPDF,
    label: BarcodeLabelData,
    showPrice: boolean,
    useArabicCurrencyFont: boolean
) {
    const horizontalPadding = 1.4
    const contentWidth = BARCODE_LABEL_WIDTH_MM - horizontalPadding * 2
    const priceText = formatBarcodeLabelPrice(label.price, label.currency, label.iqdDisplayPreference, label.unit)
    const barcodeHeight = showPrice ? 5.35 : 8.15
    const barcodeY = showPrice ? 5.3 : 1.1

    pdf.setDrawColor(212, 212, 212)
    pdf.setLineWidth(0.15)
    pdf.roundedRect(0.35, 0.35, BARCODE_LABEL_WIDTH_MM - 0.7, BARCODE_LABEL_HEIGHT_MM - 0.7, 0.55, 0.55, 'S')
    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'normal')

    if (showPrice) {
        pdf.setFontSize(1.7 * 2.835)
        pdf.text('Price', horizontalPadding, 2.1)
        pdf.setFont(useArabicCurrencyFont ? ARABIC_FONT_FAMILY : 'helvetica', useArabicCurrencyFont ? 'normal' : 'bold')
        const renderedPriceText = useArabicCurrencyFont ? pdf.processArabic(priceText) : priceText
        fitText(pdf, renderedPriceText, contentWidth, 2.7 * 2.835, 5)
        pdf.text(renderedPriceText, horizontalPadding, 4.45)
    }

    pdf.setFillColor(0, 0, 0)
    drawBarcode(pdf, label.barcode, horizontalPadding, barcodeY, contentWidth, barcodeHeight)
    pdf.setFont('courier', 'bold')
    fitText(pdf, label.displayValue, contentWidth, 1.65 * 2.835, 4.2)
    pdf.text(label.displayValue, BARCODE_LABEL_WIDTH_MM / 2, 13.95, { align: 'center' })
}

export async function generateBarcodeLabelsPdf({ labels, showPrice = true }: BarcodeLabelsPdfOptions): Promise<Blob> {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [BARCODE_LABEL_WIDTH_MM, BARCODE_LABEL_HEIGHT_MM]
    })
    const usesArabicIqdPreference = labels.some((label) =>
        label.currency.toLowerCase() === 'iqd' && label.iqdDisplayPreference !== 'IQD'
    )
    const useArabicCurrencyFont = usesArabicIqdPreference && await registerArabicFont(pdf)

    labels.forEach((label, index) => {
        if (index > 0) {
            pdf.addPage([BARCODE_LABEL_WIDTH_MM, BARCODE_LABEL_HEIGHT_MM], 'landscape')
        }
        drawLabel(
            pdf,
            label,
            showPrice,
            useArabicCurrencyFont && label.currency.toLowerCase() === 'iqd' && label.iqdDisplayPreference !== 'IQD'
        )
    })

    return pdf.output('blob') as Blob
}
