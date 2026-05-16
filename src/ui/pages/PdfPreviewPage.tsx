import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer, Loader2, Edit3, X } from 'lucide-react'
import { getInvoicePreviewSource, clearInvoicePreviewSource } from '@/lib/pdfPreviewStore'
import { EditableField } from '@/ui/components/EditableField'
import { A4InvoiceTemplate, ModernA4InvoiceTemplate } from '@/ui/components'
import { SaleReceiptBase } from '@/ui/components/SaleReceipt'
import type { UniversalInvoice } from '@/types'

function EditableInvoicePreview({
    data,
    features,
    workspaceId,
    workspaceName,
    workspaceFooterContacts,
    printFormat,
    onDataChange,
}: {
    data: UniversalInvoice
    features: any
    workspaceId?: string
    workspaceName?: string
    workspaceFooterContacts?: any
    printFormat: 'a4' | 'receipt'
    onDataChange: (data: UniversalInvoice) => void
}) {
    const { i18n } = useTranslation()
    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
    const isRTL = printLang === 'ar' || printLang === 'ku'


    if (printFormat === 'receipt') {
        return (
            <div className="mx-auto" style={{ width: '80mm', maxWidth: '100%' }}>
                <SaleReceiptBase
                    data={data}
                    features={features}
                    workspaceName={workspaceName || 'Atlas'}
                    workspaceId={workspaceId}
                />
            </div>
        )
    }

    if (features.a4_template === 'modern') {
        return (
            <div className="max-w-[900px] mx-auto">
                <ModernA4InvoiceTemplate
                    data={data}
                    features={features}
                    workspaceId={workspaceId}
                    workspaceName={workspaceName || 'Atlas'}
                    workspaceFooterContacts={workspaceFooterContacts}
                    onDataChange={onDataChange}
                />
            </div>
        )
    }

    return (
        <div dir={isRTL ? 'rtl' : 'ltr'} className="bg-white text-black text-sm font-sans max-w-[900px] mx-auto shadow-sm border border-gray-200">
            <A4InvoiceTemplate
                data={data}
                features={features}
                workspaceId={workspaceId}
                workspaceName={workspaceName || 'Atlas'}
                workspaceFooterContacts={workspaceFooterContacts}
                onDataChange={onDataChange}
            />
        </div>
    )
}

export function PdfPreviewPage() {
    const { t } = useTranslation()
    const [isSaving, setIsSaving] = useState(false)

    const sourceRef = useRef(getInvoicePreviewSource())
    const source = sourceRef.current
    const [editableData, setEditableData] = useState<UniversalInvoice | null>(null)
    const title = source?.title || t('pdfPreview.title') || 'Invoice Preview'

    const initialized = useRef(false)
    if (source && source.data && !initialized.current) {
        editableData === null && setEditableData({ ...source.data })
        initialized.current = true
    }

    // Template preview mode (loans, orders, budget)
    const templatePreview = source?.templatePreview
    const [fieldValues, setFieldValues] = useState<Record<string, string> | null>(
        () => templatePreview ? Object.fromEntries(templatePreview.fields.map(f => [f.key, f.value])) : null
    )
    const [editPanelOpen, setEditPanelOpen] = useState(false)

    const showNativePdf = source?.url && !source?.data

    const handleBack = useCallback(() => {
        clearInvoicePreviewSource()
        window.history.back()
    }, [])

    const handleSave = useCallback(async () => {
        if (!source || !editableData || isSaving) return
        setIsSaving(true)
        try {
            if (source.generatePdfBlob) {
                const blob = await source.generatePdfBlob(editableData)
                await source.onSave?.(blob)
            } else {
                await source.onSave?.(new Blob())
            }
        } catch (err) {
            console.error('Failed to save:', err)
        } finally {
            setIsSaving(false)
            clearInvoicePreviewSource()
            window.history.back()
        }
    }, [source, editableData, isSaving])

    if (!source) {
        return (
            <div className="flex h-screen items-center justify-center bg-background"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <p className="text-muted-foreground">{t('common.noData') || 'No data'}</p>
            </div>
        )
    }

    const handleNativeSave = useCallback(async () => {
        if (!source || isSaving) return
        setIsSaving(true)
        try {
            await source.onSave?.(new Blob([]))
        } catch (err) {
            console.error('Failed to save:', err)
        } finally {
            setIsSaving(false)
            clearInvoicePreviewSource()
            window.history.back()
        }
    }, [source, isSaving])

    const handleTemplatePreviewSave = useCallback(async () => {
        if (!source || !templatePreview || !fieldValues || isSaving) return
        setIsSaving(true)
        try {
            const element = templatePreview.createElement(fieldValues, source.effectiveId)
            const blob = await templatePreview.buildPdf(element)
            await source.onSave?.(blob)
        } catch (err) {
            console.error('Failed to save template preview:', err)
        } finally {
            setIsSaving(false)
            clearInvoicePreviewSource()
            window.history.back()
        }
    }, [source, templatePreview, fieldValues, isSaving])

    const handleFieldChange = useCallback((key: string, value: string) => {
        setFieldValues(prev => prev ? { ...prev, [key]: value } : null)
    }, [])

    if (templatePreview && fieldValues) {
        return (
            <div className="flex h-screen w-screen flex-col bg-gray-50 overflow-hidden"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-20">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                            onClick={handleBack}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <h1 className="text-sm font-semibold truncate">{title}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {templatePreview.fields.length > 0 && (
                            <button
                                className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                onClick={() => setEditPanelOpen(o => !o)}
                            >
                                <Edit3 className="h-3.5 w-3.5" />
                                {editPanelOpen ? (t('common.close') || 'Close') : (t('common.edit') || 'Edit')}
                            </button>
                        )}
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            onClick={handleTemplatePreviewSave}
                            disabled={isSaving}
                        >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                            {t('print.printAndSave') || 'Print & Save'}
                        </button>
                    </div>
                </header>
                <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 overflow-auto p-6">
                        <div className="max-w-[900px] mx-auto">
                            {templatePreview.createElement(fieldValues, source.effectiveId)}
                        </div>
                    </div>
                    {editPanelOpen && (
                        <div className="w-72 shrink-0 border-l bg-card overflow-y-auto p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">{t('common.fields') || 'Fields'}</h3>
                                <button
                                    className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-accent transition-colors"
                                    onClick={() => setEditPanelOpen(false)}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            {templatePreview.fields.map(f => (
                                <div key={f.key} className="space-y-1">
                                    <label className="text-[11px] font-medium text-muted-foreground">{f.label}</label>
                                    <EditableField
                                        value={fieldValues[f.key] ?? ''}
                                        onChange={(v) => handleFieldChange(f.key, v)}
                                        type={f.type}
                                        className="text-sm"
                                        inputClassName="w-full"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (showNativePdf) {
        return (
            <div className="flex h-screen w-screen flex-col bg-background overflow-hidden"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                            onClick={handleBack}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <h1 className="text-sm font-semibold truncate">{title}</h1>
                    </div>
                    {source.onSave && (
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            onClick={handleNativeSave}
                            disabled={isSaving}
                        >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                            {t('print.printAndSave') || 'Print & Save'}
                        </button>
                    )}
                </header>
                <div className="flex-1">
                    <object data={source.url} type="application/pdf" className="w-full h-full">
                        <iframe src={source.url} className="w-full h-full" title={title} />
                    </object>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen w-screen flex-col bg-gray-50 overflow-hidden"
            style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
            <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                        onClick={handleBack}
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <h1 className="text-sm font-semibold truncate">{title}</h1>
                </div>
                <div className="flex items-center gap-2">
                    {editableData && (
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            onClick={() => setEditPanelOpen(o => !o)}
                        >
                            <Edit3 className="h-3.5 w-3.5" />
                            {editPanelOpen ? (t('common.close') || 'Close') : (t('common.edit') || 'Edit')}
                        </button>
                    )}
                    <button
                        className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                        {t('print.printAndSave') || 'Print & Save'}
                    </button>
                </div>
            </header>
            <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-auto p-6">
                    {editableData && source.features && source.printFormat && (
                        <EditableInvoicePreview
                            data={editableData}
                            features={source.features}
                            workspaceId={source.workspaceId}
                            workspaceName={source.workspaceName}
                            workspaceFooterContacts={source.workspaceFooterContacts}
                            printFormat={source.printFormat}
                            onDataChange={setEditableData}
                        />
                    )}
                </div>
                {editPanelOpen && editableData && (
                    <div className="w-72 shrink-0 border-l bg-card overflow-y-auto p-4 space-y-4">
                        <div className="flex items-center justify-between z-10 sticky top-0 bg-card pb-2">
                            <h3 className="text-sm font-semibold">{t('common.fields') || 'Common Fields'}</h3>
                            <button
                                className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-accent transition-colors"
                                onClick={() => setEditPanelOpen(false)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="space-y-3">

                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-muted-foreground">{t('invoice.soldTo')}</label>
                                <EditableField
                                    value={editableData.customer_name || ''}
                                    onChange={(v) => setEditableData(prev => prev ? { ...prev, customer_name: v } : null)}
                                    type="text"
                                    className="text-sm w-full block border border-transparent hover:border-blue-400"
                                    inputClassName="w-full"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-muted-foreground">{t('invoice.terms')}</label>
                                <EditableField
                                    value={editableData.terms || ''}
                                    onChange={(v) => setEditableData(prev => prev ? { ...prev, terms: v } : null)}
                                    type="textarea"
                                    className="text-sm w-full block border border-transparent hover:border-blue-400 min-h-[60px]"
                                    inputClassName="w-full min-h-[60px]"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
