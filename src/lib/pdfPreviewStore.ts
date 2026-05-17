import type { UniversalInvoice } from '@/types'
import type { ReactElement } from 'react'

export type PrintFormat = 'a4' | 'receipt'

export type TemplatePreviewField = {
    key: string
    label: string
    value: string
    type: 'text' | 'number' | 'date'
}

export type TemplatePreview = {
    fields: TemplatePreviewField[]
    createElement: (data: Record<string, string>, effectiveId?: string, printLangOverride?: string) => ReactElement
    buildPdf: (element: ReactElement, printLangOverride?: string) => Promise<Blob>
}

export type InvoicePreviewSource = {
    data?: UniversalInvoice
    features?: any
    workspaceId?: string
    workspaceName?: string
    workspaceFooterContacts?: any
    printFormat?: PrintFormat
    title: string
    onSave?: (blob: Blob) => Promise<void>
    invoiceData?: any
    effectiveId?: string
    generatePdfBlob?: (editedData: UniversalInvoice, printLangOverride?: string) => Promise<Blob>
    /** Fallback: PDF blob/data URL for read-only viewing when structured data isn't available */
    url?: string
    /** Template preview mode for editable inline preview of custom templates (loans, orders, budget) */
    templatePreview?: TemplatePreview
}

let _source: InvoicePreviewSource | null = null

export function setInvoicePreviewSource(source: InvoicePreviewSource) {
    _source = source
}

export function getInvoicePreviewSource(): InvoicePreviewSource | null {
    return _source
}

export function clearInvoicePreviewSource() {
    _source = null
}
