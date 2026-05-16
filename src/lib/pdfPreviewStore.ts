type PdfPreviewSource = {
    url: string
    title?: string
    onSave?: () => void
}

let _source: PdfPreviewSource | null = null

export function setPdfPreviewSource(source: PdfPreviewSource) {
    _source = source
}

export function getPdfPreviewSource(): PdfPreviewSource | null {
    return _source
}

export function clearPdfPreviewSource() {
    _source = null
}
