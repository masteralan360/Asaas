import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer, Loader2, Edit3, X } from 'lucide-react'
import { getInvoicePreviewSource, clearInvoicePreviewSource } from '@/lib/pdfPreviewStore'
import { EditableField } from '@/ui/components/EditableField'
import { formatCurrency } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import { ReactQRCode } from '@lglab/react-qr-code'
import type { UniversalInvoice } from '@/types'

function FieldLabel({ label }: { label: string }) {
    return <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
}

function formatValue(v: unknown): string {
    if (v === undefined || v === null) return ''
    return String(v)
}

function EditableInvoicePreview({
    data,
    features,
    workspaceId,
    workspaceName,
    printFormat,
    onDataChange,
}: {
    data: UniversalInvoice
    features: any
    workspaceId?: string
    workspaceName?: string
    printFormat: 'a4' | 'receipt'
    onDataChange: (data: UniversalInvoice) => void
}) {
    const { i18n } = useTranslation()
    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
    const t = i18n.getFixedT(printLang)
    const isRTL = printLang === 'ar' || printLang === 'ku'
    const settlementCurrency = data.settlement_currency || 'usd'
    const iqdDisplay = features?.iqd_display_preference

    const [terms, setTerms] = useState('')

    const updateField = useCallback((field: string, value: string) => {
        onDataChange({ ...data, [field]: value })
    }, [data, onDataChange])

    const updateNumericField = useCallback((field: string, value: string) => {
        const num = parseFloat(value) || 0
        onDataChange({ ...data, [field]: num })
    }, [data, onDataChange])

    const updateItem = useCallback((index: number, field: string, value: string) => {
        const newItems = [...(data.items || [])]
        const item = { ...newItems[index] }
        if (field === 'quantity' || field === 'unit_price' || field === 'discount_amount') {
            const num = parseFloat(value) || 0
            ;(item as any)[field] = num
            if (field === 'quantity' || field === 'unit_price') {
                item.total_price = item.quantity * item.unit_price
            }
        } else {
            ;(item as any)[field] = value
        }
        newItems[index] = item
        const totalAmount = newItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
        onDataChange({ ...data, items: newItems, total_amount: totalAmount, subtotal_amount: totalAmount })
    }, [data, onDataChange])

    const uniqueOriginalCurrencies = Array.from(new Set((data.items || []).map(i => i.original_currency || 'usd')))
        .filter(c => c !== settlementCurrency)
    const currencyTotals: Record<string, number> = {}
    uniqueOriginalCurrencies.forEach(curr => {
        currencyTotals[curr] = (data.items || [])
            .filter(i => (i.original_currency || 'usd') === curr)
            .reduce((sum, i) => sum + ((i.original_unit_price || 0) * (i.quantity || 0)), 0)
    })

    if (printFormat === 'receipt') {
        return (
            <div className="mx-auto" style={{ width: '80mm', maxWidth: '100%' }} dir={isRTL ? 'rtl' : 'ltr'}>
                <div className="bg-white p-4 text-xs space-y-3">
                    <div className="text-center space-y-1">
                        {features.logo_url ? (
                            <img src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)} alt="Logo" className="max-h-10 mx-auto object-contain" />
                        ) : null}
                        {features.print_qr && workspaceId && (data.sequenceId || data.invoiceid) && (
                            <div className="flex justify-center">
                                <ReactQRCode value={`https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${data.id}.pdf`} size={48} level="M" />
                            </div>
                        )}
                        <div className="font-bold text-sm">{workspaceName || 'Atlas'}</div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between">
                            <FieldLabel label={t('invoice.date')} />
                            <EditableField value={formatValue(data.created_at)} onChange={(v) => updateField('created_at', v)} type="text" className="text-xs font-bold" />
                        </div>
                        <div className="flex justify-between">
                            <FieldLabel label={t('invoice.number')} />
                            <EditableField value={formatValue(data.invoiceid || `#${String(data.id).slice(0, 8)}`)} onChange={(v) => updateField('invoiceid', v)} type="text" className="text-xs font-bold" />
                        </div>
                        <div className="flex justify-between">
                            <FieldLabel label={t('sales.print.cashier')} />
                            <EditableField value={formatValue(data.cashier_name)} onChange={(v) => updateField('cashier_name', v)} type="text" className="text-xs font-bold" />
                        </div>
                        <div className="flex justify-between">
                            <FieldLabel label={t('sales.print.paymentMethod')} />
                            <EditableField value={formatValue(data.payment_method)} onChange={(v) => updateField('payment_method', v)} type="text" className="text-xs font-bold" />
                        </div>
                    </div>
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b border-gray-300 text-[10px] text-slate-500">
                                <th className="text-left py-1">{t('invoice.productName')}</th>
                                <th className="text-center py-1 w-10">{t('invoice.qty')}</th>
                                <th className="text-right py-1 w-16">{t('invoice.price')}</th>
                                <th className="text-right py-1 w-16">{t('invoice.total')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.items || []).map((item, idx) => (
                                <tr key={idx} className="border-b border-gray-100">
                                    <td className="py-1"><EditableField value={formatValue(item.product_name)} onChange={(v) => updateItem(idx, 'product_name', v)} type="text" className="text-xs font-semibold" /></td>
                                    <td className="py-1 text-center"><EditableField value={item.quantity} onChange={(v) => updateItem(idx, 'quantity', v)} type="number" className="text-xs text-center" inputClassName="w-12 text-center" /></td>
                                    <td className="py-1 text-right"><EditableField value={item.unit_price} onChange={(v) => updateItem(idx, 'unit_price', v)} type="number" className="text-xs tabular-nums" inputClassName="w-16 text-right" /></td>
                                    <td className="py-1 text-right font-bold text-xs">{formatCurrency(item.total_price, settlementCurrency, iqdDisplay)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="flex justify-between font-bold text-sm pt-2 border-t border-gray-300">
                        <span>{t('invoice.total')}</span>
                        <EditableField value={data.total_amount} onChange={(v) => updateNumericField('total_amount', v)} type="number" className="text-sm font-bold tabular-nums" inputClassName="w-20 text-right" />
                    </div>
                    <div className="text-[9px] text-slate-400 text-center pt-2 border-t border-gray-100">
                        {data.origin === 'pos' ? t('invoice.posSystem') : 'Atlas'} | {t('invoice.generated')}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div dir={isRTL ? 'rtl' : 'ltr'} className="bg-white text-black text-sm font-sans max-w-[900px] mx-auto shadow-sm border border-gray-200">
            <style>{`.text-main { color: #5c6ac4; } .bg-main { background-color: #5c6ac4; } .border-main { border-color: #5c6ac4; }`}</style>
            <div className="px-10 py-6">
                <div className="flex justify-between items-start">
                    <div className="w-1/3 flex flex-col items-start gap-1">
                        <div className="flex items-start w-full max-w-[200px] mb-1">
                            {features.logo_url ? (
                                <img src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)} alt="Logo" className="max-h-16 max-w-full object-contain object-left" />
                            ) : (
                                <div className="h-12 flex items-center bg-gray-100 border border-gray-200 justify-center w-48 text-gray-400 font-bold tracking-wider uppercase text-xs">LOGO</div>
                            )}
                        </div>
                        {workspaceName && <div className="text-main font-bold text-xl leading-tight">{workspaceName}</div>}
                    </div>
                    <div className="w-1/3 flex justify-center pt-2">
                        {features.print_qr && workspaceId && (data.sequenceId || data.invoiceid) && (
                            <div className="p-1.5 bg-white border border-slate-100 rounded">
                                <ReactQRCode value={`https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${data.id}.pdf`} size={64} level="M" />
                            </div>
                        )}
                    </div>
                    <div className={`w-1/3 flex flex-col ${isRTL ? 'items-start text-left' : 'items-end text-right'}`}>
                        <div className={`flex flex-col gap-1 border-r-4 border-main ${isRTL ? 'pr-0 border-l-4 border-r-0' : 'pr-4'}`}>
                            <div>
                                <FieldLabel label={t('invoice.date')} />
                                <EditableField value={formatValue(data.created_at)} onChange={(v) => updateField('created_at', v)} type="text" className="whitespace-nowrap font-bold text-main text-sm leading-tight" />
                            </div>
                            <div className="mt-1">
                                <FieldLabel label={t('invoice.number')} />
                                <EditableField value={formatValue(data.invoiceid || `#${String(data.id).slice(0, 8)}`)} onChange={(v) => updateField('invoiceid', v)} type="text" className="whitespace-nowrap font-bold text-main text-lg leading-tight" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="bg-slate-100 px-10 py-6 text-sm">
                <table className="w-full border-collapse">
                    <tbody>
                        <tr>
                            <td className="w-1/2 align-top text-neutral-600 text-start">
                                <p className="font-bold text-black mb-1">{t('invoice.soldTo')}</p>
                                <EditableField value={formatValue(data.customer_name)} onChange={(v) => updateField('customer_name', v)} type="text" placeholder="Customer name" className="border-b border-dashed border-gray-300 pb-0.5 font-medium text-black inline-block" />
                            </td>
                            <td className={`w-1/2 align-top text-neutral-600 ${isRTL ? 'text-left' : 'text-right'}`}>
                                <p className="font-bold text-black mb-1">{t('invoice.soldBy')}</p>
                                <EditableField value={formatValue(data.cashier_name)} onChange={(v) => updateField('cashier_name', v)} type="text" className="font-mono font-bold text-main text-lg" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="px-10 py-8">
                <table className="w-full border-collapse">
                    <thead>
                        <tr>
                            <th className="border-b-2 border-main pb-3 px-2 text-center font-bold text-main w-[60px]">{t('invoice.qty')}</th>
                            <th className="border-b-2 border-main pb-3 px-2 text-start font-bold text-main">{t('invoice.productName')}</th>
                            <th className="border-b-2 border-main pb-3 px-2 text-start font-bold text-main">{t('invoice.description')}</th>
                            <th className="border-b-2 border-main pb-3 px-2 text-end font-bold text-main w-[100px]">{t('invoice.price')}</th>
                            <th className="border-b-2 border-main pb-3 px-2 text-center font-bold text-main w-[80px]">{t('invoice.discount')}</th>
                            <th className="border-b-2 border-main pb-3 px-2 text-end font-bold text-main w-[110px]">{t('invoice.total')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(data.items || []).map((item, idx) => {
                            const finalUnitPrice = item.unit_price || 0
                            const total = item.total_price || (finalUnitPrice * item.quantity)
                            const discountAmount = item.discount_amount || 0
                            return (
                                <tr key={idx} className="text-neutral-700">
                                    <td className="border-b py-2 px-2 text-center"><EditableField value={item.quantity} onChange={(v) => updateItem(idx, 'quantity', v)} type="number" className="font-bold text-center" inputClassName="w-14 text-center" /></td>
                                    <td className="border-b py-2 px-2"><EditableField value={formatValue(item.product_name)} onChange={(v) => updateItem(idx, 'product_name', v)} type="text" className="font-bold" /></td>
                                    <td className="border-b py-2 px-2 text-sm text-neutral-500 truncate max-w-[200px] text-start"></td>
                                    <td className="border-b py-2 px-2 text-end"><EditableField value={item.unit_price} onChange={(v) => updateItem(idx, 'unit_price', v)} type="number" className="tabular-nums" inputClassName="w-20 text-right" /></td>
                                    <td className="border-b py-2 px-2 text-center text-neutral-400"><EditableField value={discountAmount} onChange={(v) => updateItem(idx, 'discount_amount', v)} type="number" className="text-center" inputClassName="w-14 text-center" /></td>
                                    <td className="border-b py-2 px-2 text-end font-bold text-black">{formatCurrency(total, settlementCurrency, iqdDisplay)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="px-10 pb-12">
                <div className="flex gap-8 items-start">
                    <div className="flex-1 text-sm text-neutral-700 space-y-6 text-start">
                        <div>
                            <FieldLabel label={t('invoice.terms')} />
                            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms & Conditions" className="mt-2 w-full border border-dashed border-gray-300 rounded p-2 text-xs resize-none focus:outline-none focus:border-blue-400" rows={3} />
                        </div>
                        {data.exchange_rates && data.exchange_rates.length > 0 && (
                            <div>
                                <FieldLabel label={t('invoice.exchangeRates')} />
                                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                                    {data.exchange_rates.slice(0, 4).map((rate: any, i: number) => (
                                        <div key={i} className="flex justify-between bg-white px-2 py-1 rounded-full border border-gray-100 shadow-sm">
                                            <span className="text-[10px] font-bold text-slate-400">{rate.pair}</span>
                                            <span className="font-mono font-black text-main">{rate.rate}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="w-[350px]">
                        <table className="w-full border-collapse border-spacing-0">
                            <tbody>
                                <tr>
                                    <td className="border-b p-3 text-start"><span className="whitespace-nowrap text-slate-400 text-sm">{t('invoice.subtotal')}:</span></td>
                                    <td className="border-b p-3 text-end">
                                        <EditableField value={data.subtotal_amount ?? data.total_amount} onChange={(v) => updateNumericField('subtotal_amount', v)} type="number" className="whitespace-nowrap font-bold text-main text-lg" inputClassName="w-24 text-right" />
                                    </td>
                                </tr>
                                {Object.entries(currencyTotals).map(([code, amount], idx) => (
                                    <tr key={idx}>
                                        <td className="p-2 border-b border-dashed border-gray-100 text-start"><span className="whitespace-nowrap text-slate-300 text-[10px] font-bold lowercase italic">{t('common.total')} ({code}):</span></td>
                                        <td className="p-2 border-b border-dashed border-gray-100 text-end"><span className="whitespace-nowrap font-bold text-slate-400 text-xs tabular-nums">{formatCurrency(amount, code, iqdDisplay)}</span></td>
                                    </tr>
                                ))}
                                <tr>
                                    <td className="bg-main p-3 text-start"><span className="whitespace-nowrap font-black text-white text-lg">{t('invoice.total')}:</span></td>
                                    <td className="bg-main p-3 text-end">
                                        <EditableField value={data.total_amount} onChange={(v) => updateNumericField('total_amount', v)} type="number" className="whitespace-nowrap font-bold text-white text-xl" inputClassName="w-28 text-right" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="mt-8 border-t border-gray-200 pt-3 text-center text-xs text-neutral-500">
                    {data.origin === 'pos' ? t('invoice.posSystem') : 'Atlas'}
                    <span className="text-slate-300 px-2">|</span>
                    {t('invoice.generated')}
                </div>
            </div>
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
            await source.onSave?.()
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
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            onClick={() => setEditPanelOpen(o => !o)}
                        >
                            <Edit3 className="h-3.5 w-3.5" />
                            {editPanelOpen ? (t('common.close') || 'Close') : (t('common.edit') || 'Edit')}
                        </button>
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
                <button
                    className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    onClick={handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    {t('print.printAndSave') || 'Print & Save'}
                </button>
            </header>
            <div className="flex-1 overflow-auto p-6">
                {editableData && source.features && source.printFormat && (
                    <EditableInvoicePreview
                        data={editableData}
                        features={source.features}
                        workspaceId={source.workspaceId}
                        workspaceName={source.workspaceName}
                        printFormat={source.printFormat}
                        onDataChange={setEditableData}
                    />
                )}
            </div>
        </div>
    )
}
