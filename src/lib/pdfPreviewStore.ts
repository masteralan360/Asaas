import type { UniversalInvoice } from '@/types'
import type { ReactElement } from 'react'

export type PrintFormat = 'a4' | 'receipt'

export type TemplatePreviewField = {
    key: string
    label: string
    value: string
    type: 'text' | 'number' | 'date'
}

export type TemplatePreviewRenderOptions = {
    editableFields?: boolean
    onFieldChange?: (key: string, value: string) => void
}

export type TemplatePreview = {
    fields: TemplatePreviewField[]
    createElement: (
        data: Record<string, string>,
        effectiveId?: string,
        printLangOverride?: string,
        renderOptions?: TemplatePreviewRenderOptions
    ) => ReactElement
    buildPdf: (element: ReactElement, printLangOverride?: string) => Promise<Blob>
    fixedPrintLang?: 'en' | 'ar' | 'ku'
}

export type CustomTemplateAnnotation = {
    type: 'pen' | 'brush'
    points: { x: number; y: number }[]
    color: string
    brushSize: number
}

export type CustomTemplateText = {
    id: string
    text: string
    x: number
    y: number
    width: number
    rotation: number
    fontSize?: number | ''
    color?: string
}

export type CustomTemplateImage = {
    path: string
    x: number
    y: number
    width: number
    rotation?: number
}

export type CustomTemplateLayout = {
    version: 1
    moduleTypeKey: string
    nativeTemplateKey?: string
    page: {
        widthMm: number
        heightMm: number
    }
    fields: Record<string, string>
    annotations: CustomTemplateAnnotation[]
    texts: CustomTemplateText[]
    images: CustomTemplateImage[]
    updatedAt: string
}

export type CustomTemplatePreviewTarget = {
    moduleTypeKey: string
    nativeTemplateKey?: string
    templateId?: string
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
    customTemplate?: CustomTemplatePreviewTarget
    initialTemplateLayout?: CustomTemplateLayout | null
    onSaveTemplateLayout?: (layout: CustomTemplateLayout) => Promise<void>
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
