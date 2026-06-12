import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { useReactToPrint } from 'react-to-print'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button,
    useToast,
    A4InvoiceTemplate,
    ModernA4InvoiceTemplate,
    RefundA4InvoiceTemplate,
    RefundPrimaryA4InvoiceTemplate,
    SaleReceiptBase
} from '@/ui/components'
import { Printer, X, ExternalLink, Loader2 } from 'lucide-react'
import { saveInvoiceFromSnapshot, useWorkspaceContacts } from '@/local-db/hooks'
import { useAuth } from '@/auth'
import { db, type Invoice } from '@/local-db'
import { generateInvoicePdf, type PrintFormat } from '@/services/pdfGenerator'
import { assetManager } from '@/lib/assetManager'
import { isOnline } from '@/lib/network'
import {
    disableInvoiceQrInLocalMode,
    saveInvoicePdfToLocalAppData,
    shouldUseLocalInvoiceStorage
} from '@/services/localInvoiceStorage'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'
import { supabase } from '@/auth/supabase'
import { getRetriableActionToast, isRetriableWebRequestError, normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import {
    setInvoicePreviewSource,
    type CustomTemplateLayout,
    type CustomTemplatePreviewTarget,
    type TemplatePreview
} from '@/lib/pdfPreviewStore'
import { useWorkspacePermissions } from '@/permissions/WorkspacePermissionsContext'
import {
    PrintSelectionModal,
    type PrintSelectionNativeOption,
    type PrintSelectionTemplateOption
} from '@/ui/components/PrintSelectionModal'
import type { StoredCustomTemplateRow } from '@/lib/customTemplates'

interface PrintPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm?: () => void
    title?: string
    children?: ReactNode
    showSaveButton?: boolean
    saveButtonText?: string
    invoiceData?: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'> & { invoiceid?: string }
    pdfData?: any // UniversalInvoice
    pdfBuilder?: (options: { format: PrintFormat; effectiveId: string; printLangOverride?: string }) => Promise<Blob>
    documentId?: string
    printTemplate?: ReactNode | ((options: { effectiveId: string }) => ReactNode)
    templatePreview?: TemplatePreview
    customTemplate?: CustomTemplatePreviewTarget
    templateFieldValues?: Record<string, string>
    initialTemplateLayout?: CustomTemplateLayout | null
    allowTemplateFieldEditing?: boolean
    enableTemplatePreviewSave?: boolean
    templatePrimaryActionLabel?: string
    generateTemplateLayoutBlob?: (layout: CustomTemplateLayout, printLangOverride?: string, effectiveId?: string) => Promise<Blob>
    features?: WorkspaceFeatures
    workspaceName?: string | null
    module?: string
    printSelectionOptions?: PrintSelectionNativeOption[]
    printSelectionTemplates?: PrintSelectionTemplateOption[]
    onPrintSelection?: (format: PrintFormat, template?: StoredCustomTemplateRow) => void
}

type WorkspaceContactPair = {
    primary?: string
    nonPrimary?: string
}

type WorkspaceFooterContacts = {
    address?: WorkspaceContactPair
    email?: WorkspaceContactPair
    phone?: WorkspaceContactPair
}

export function PrintPreviewModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    children,
    showSaveButton = true,
    saveButtonText,
    invoiceData,
    pdfData,
    pdfBuilder,
    documentId,
    printTemplate,
    templatePreview: templatePreviewProp,
    customTemplate,
    templateFieldValues,
    initialTemplateLayout,
    allowTemplateFieldEditing,
    enableTemplatePreviewSave,
    templatePrimaryActionLabel,
    generateTemplateLayoutBlob,
    features,
    workspaceName,
    module,
    printSelectionOptions,
    printSelectionTemplates,
    onPrintSelection
}: PrintPreviewModalProps) {
    const { t, i18n } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { hasCapability } = useWorkspace()
    const { hasPermission } = useWorkspacePermissions()
    const [, setLocation] = useLocation()
    const workspaceId = user?.workspaceId
    const workspaceContacts = useWorkspaceContacts(workspaceId)
    const [selectedPrintFormat, setSelectedPrintFormat] = useState<PrintFormat | null>(null)

    useEffect(() => {
        if (!isOpen) {
            setSelectedPrintFormat(null)
        }
    }, [isOpen])

    // Generate a stable ID for new invoices to ensure QR code consistency
    // If pdfData.id exists (history), we use that. If not (new sale), we generate one.
    const [tempId, setTempId] = useState<string>('')

    // The actual ID to be used for generation and saving
    const effectiveId = useMemo(
        () => pdfData?.id || documentId || tempId,
        [pdfData?.id, documentId, tempId]
    )

    useEffect(() => {
        if (isOpen && !pdfData?.id && !documentId) {
            setTempId(crypto.randomUUID())
        }
    }, [isOpen, pdfData?.id, documentId])

    const [isSaving, setIsSaving] = useState(false)
    const htmlPrintRef = useRef<HTMLDivElement>(null)
    const templatePrintRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!isOpen) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault()
                e.stopPropagation()
            }
        }
        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [isOpen])

    const hasPdfData = !!pdfBuilder || !!(pdfData && features)
    const requestedPrintFormat: PrintFormat = (invoiceData?.printFormat || 'a4') as PrintFormat
    const defaultPrintFormat: PrintFormat = requestedPrintFormat === 'a4' && !hasCapability('a4PdfInvoices')
        ? 'receipt'
        : requestedPrintFormat
    const printFormat = selectedPrintFormat || defaultPrintFormat
    const resolvedPrintSelectionOptions = useMemo<PrintSelectionNativeOption[]>(
        () => printSelectionOptions || [{
            format: defaultPrintFormat,
            label: title || (defaultPrintFormat === 'receipt'
                ? (t('sales.print.receipt', { defaultValue: 'Thermal Receipt' }))
                : (t('sales.print.a4', { defaultValue: 'A4 Print' }))),
            description: defaultPrintFormat === 'receipt'
                ? t('sales.print.receiptdesc', { defaultValue: 'Thermal receipt document' })
                : t('sales.print.a4desc', { defaultValue: 'Detailed full-page document' })
        }],
        [defaultPrintFormat, printSelectionOptions, t, title]
    )
    const handlePrintSelection = useCallback((
        format: PrintFormat,
        template?: StoredCustomTemplateRow
    ) => {
        onPrintSelection?.(format, template)
        setSelectedPrintFormat(format)
    }, [onPrintSelection])
    const usesLocalInvoiceStorage = shouldUseLocalInvoiceStorage(workspaceId)
    const printableFeatures = useMemo(
        () => disableInvoiceQrInLocalMode(workspaceId, features),
        [features, workspaceId]
    )
    const printLang = printableFeatures?.print_lang && printableFeatures.print_lang !== 'auto' ? printableFeatures.print_lang : i18n.language
    const t_print = useMemo(() => i18n.getFixedT(printLang), [i18n, printLang])

    const canPrint = useMemo(() => {
        // Use module specific print permission or fallback to global logic handled by hasPermission
        const permissionKey = `${module || 'global'}.print` as any
        return hasPermission(permissionKey)
    }, [hasPermission, module])

    const translations = useMemo(() => ({
        date: t_print('sales.print.date') || 'Date',
        number: t_print('sales.print.number') || 'Invoice #',
        soldTo: t_print('sales.print.soldTo') || 'Sold To',
        soldBy: t_print('sales.print.soldBy') || 'Sold By',
        qty: t_print('sales.print.qty') || 'Qty',
        productName: t_print('sales.print.productName') || 'Product',
        description: t_print('sales.print.description') || 'Description',
        price: t_print('sales.print.price') || 'Price',
        discount: t_print('sales.print.discount') || 'Discount',
        total: t_print('sales.print.total') || 'Total',
        subtotal: t_print('sales.print.subtotal') || 'Subtotal',
        terms: t_print('sales.print.terms') || 'Terms & Conditions',
        exchangeRates: t_print('sales.print.exchangeRates') || 'Exchange Rates',
        posSystem: t_print('sales.print.posSystem') || 'POS System',
        generated: t_print('sales.print.generated') || 'Generated',
        id: t_print('sales.print.id') || 'ID',
        cashier: t_print('sales.print.cashier') || 'Cashier',
        paymentMethod: t_print('sales.print.paymentMethod') || 'Payment Method',
        name: t_print('sales.print.name') || 'Name',
        quantity: t_print('sales.print.quantity') || 'Qty',
        thankYou: t_print('sales.print.thankYou') || 'Thank You',
        keepRecord: t_print('sales.print.keepRecord') || 'Please keep this for your records',
        snapshots: t_print('sales.print.snapshots') || 'Snapshots'
    }), [t_print])

    const workspaceFooterContacts = useMemo<WorkspaceFooterContacts>(() => {
        const pickContactPair = (type: 'address' | 'email' | 'phone'): WorkspaceContactPair => {
            const contactsOfType = workspaceContacts.filter((contact) =>
                contact.type === type
                && typeof contact.value === 'string'
                && contact.value.trim().length > 0
            )
            if (contactsOfType.length === 0) return {}

            const primaryContact = contactsOfType.find((contact) => contact.isPrimary) || contactsOfType[0]
            const primary = primaryContact.value.trim()
            const nonPrimaryContact = contactsOfType.find((contact) =>
                contact.id !== primaryContact.id
                && (!contact.isPrimary || contact.value.trim() !== primary)
            )
            const nonPrimary = nonPrimaryContact?.value.trim()

            return {
                ...(primary ? { primary } : {}),
                ...(nonPrimary ? { nonPrimary } : {})
            }
        }

        return {
            address: pickContactPair('address'),
            email: pickContactPair('email'),
            phone: pickContactPair('phone')
        }
    }, [workspaceContacts])

    const templateContent = useMemo<ReactNode>(() => {
        if (printTemplate) {
            return typeof printTemplate === 'function'
                ? printTemplate({ effectiveId })
                : printTemplate
        }

        if (pdfData && printableFeatures) {
            return printFormat === 'receipt' ? (
                <div className="w-[80mm]">
                    <SaleReceiptBase
                        data={pdfData}
                        features={printableFeatures}
                        workspaceName={workspaceName || workspaceId || 'Atlas'}
                        workspaceId={workspaceId || undefined}
                    />
                </div>
            ) : (
                pdfData?.is_refund_invoice ? (
                    printableFeatures?.a4_template === 'modern' ? (
                        <RefundA4InvoiceTemplate
                            data={pdfData}
                            features={printableFeatures}
                            workspaceId={workspaceId || undefined}
                            workspaceName={workspaceName || workspaceId || 'Atlas'}
                        />
                    ) : (
                        <RefundPrimaryA4InvoiceTemplate
                            data={pdfData}
                            features={printableFeatures}
                            workspaceId={workspaceId || undefined}
                            workspaceName={workspaceName || workspaceId || 'Atlas'}
                        />
                    )
                ) : printableFeatures?.a4_template === 'modern' ? (
                    <ModernA4InvoiceTemplate
                        data={pdfData}
                        features={printableFeatures}
                        workspaceId={workspaceId || undefined}
                        workspaceName={workspaceName || workspaceId || 'Atlas'}
                        workspaceFooterContacts={workspaceFooterContacts}
                    />
                ) : (
                    <A4InvoiceTemplate
                        data={pdfData}
                        features={printableFeatures}
                        workspaceId={workspaceId || undefined}
                        workspaceName={workspaceName || workspaceId || 'Atlas'}
                    />
                )
            )
        }

        return children || null
    }, [children, effectiveId, pdfData, printFormat, printTemplate, printableFeatures, workspaceFooterContacts, workspaceId, workspaceName])



    const handleHtmlPrint = useReactToPrint({
        contentRef: htmlPrintRef,
        documentTitle: title || 'Print_Preview',
        onAfterPrint: () => {
            if (onConfirm) onConfirm()
        }
    })



    const buildPdfBlobs = useCallback(async (requestedFormat?: PrintFormat, printLangOverride?: string): Promise<{ a4?: Blob; receipt?: Blob }> => {
        const format = requestedFormat || printFormat
        const effectiveLang = printLangOverride || printLang

        if (pdfBuilder) {
            const blob = await pdfBuilder({ format, effectiveId, printLangOverride })
            return { [format]: blob }
        }

        if (!pdfData || !printableFeatures) {
            throw new Error('Missing PDF data or features')
        }

        const blob = await generateInvoicePdf({
            data: { ...pdfData, id: effectiveId },
            format: format,
            workspaceId: workspaceId || '',
            features: {
                ...printableFeatures,
                logo_url: printableFeatures.logo_url || undefined,
                print_lang: effectiveLang
            },
            workspaceName: workspaceName || workspaceId || '',
            translations,
            workspaceFooterContacts
        })

        return { [format]: blob }
    }, [printableFeatures, pdfData, pdfBuilder, translations, workspaceId, workspaceName, effectiveId, printFormat, printLang, workspaceFooterContacts])

    const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
    }, [])

    const ensureSaveBlob = useCallback(async (printLangOverride?: string): Promise<Blob> => {
        const effectiveLang = printLangOverride || printLang
        if (pdfBuilder) {
            return await pdfBuilder({ format: printFormat, effectiveId, printLangOverride })
        }
        if (!pdfData || !printableFeatures) throw new Error('Missing PDF data')
        return await generateInvoicePdf({
            data: { ...pdfData, id: effectiveId },
            format: printFormat,
            workspaceId: workspaceId || '',
            features: { 
                ...printableFeatures, 
                logo_url: printableFeatures.logo_url || undefined,
                print_lang: effectiveLang
            },
            workspaceName: workspaceName || workspaceId || '',
            translations,
            workspaceFooterContacts
        })
    }, [pdfBuilder, pdfData, printableFeatures, printFormat, effectiveId, workspaceId, workspaceName, translations, printLang, workspaceFooterContacts])

    const handleSave = useCallback(async (preGeneratedBlob?: Blob) => {
        if (isSaving) return
        if (!hasPdfData) { handleHtmlPrint(); return }

        setIsSaving(true)
        try {
            const activeBlob = preGeneratedBlob || await ensureSaveBlob()
            let savedInvoice: Invoice | null = null

            if (invoiceData && workspaceId) {
                const snapshotData: any = { ...invoiceData, printFormat }
                if (printFormat === 'a4') { snapshotData.pdfBlobA4 = activeBlob }
                else { snapshotData.pdfBlobReceipt = activeBlob }

                savedInvoice = await saveInvoiceFromSnapshot(workspaceId, snapshotData, effectiveId)
                const confirmedInvoice = await db.invoices.get(effectiveId)
                if (confirmedInvoice) savedInvoice = confirmedInvoice
            }

            if (savedInvoice && usesLocalInvoiceStorage) {
                try {
                    const storageWorkspaceId = workspaceId || savedInvoice.workspaceId
                    if (!storageWorkspaceId) throw new Error('Missing workspace ID')

                    const finalBlob = preGeneratedBlob || (!pdfBuilder && pdfData && printableFeatures
                        ? await generateInvoicePdf({
                            data: { ...pdfData, ...savedInvoice, id: savedInvoice.id, invoiceid: savedInvoice.invoiceid, sequenceId: savedInvoice.sequenceId },
                            format: printFormat,
                            workspaceId: workspaceId || '',
                            features: { ...printableFeatures, logo_url: printableFeatures?.logo_url || undefined },
                            workspaceName: workspaceName || workspaceId || '',
                            translations,
                            workspaceFooterContacts
                        })
                        : activeBlob)

                    const localPath = await saveInvoicePdfToLocalAppData(storageWorkspaceId, savedInvoice.id, printFormat, finalBlob)
                    const dbUpdate: any = { syncStatus: 'synced', lastSyncedAt: new Date().toISOString() }
                    if (printFormat === 'a4') {
                        dbUpdate.localPathA4 = localPath ?? undefined
                        dbUpdate.r2PathA4 = undefined
                        dbUpdate.pdfBlobA4 = localPath ? undefined : finalBlob
                    } else {
                        dbUpdate.localPathReceipt = localPath ?? undefined
                        dbUpdate.r2PathReceipt = undefined
                        dbUpdate.pdfBlobReceipt = localPath ? undefined : finalBlob
                    }
                    await db.invoices.update(savedInvoice.id, dbUpdate)
                } catch (saveError) {
                    console.error('Local invoice file save failed:', saveError)
                    const dbUpdate: any = { syncStatus: 'synced', lastSyncedAt: new Date().toISOString() }
                    if (printFormat === 'a4') { dbUpdate.pdfBlobA4 = activeBlob }
                    else { dbUpdate.pdfBlobReceipt = activeBlob }
                    await db.invoices.update(savedInvoice.id, dbUpdate)
                }
            } else if (savedInvoice && isOnline() && assetManager) {
                try {
                    const finalBlob = preGeneratedBlob || (!pdfBuilder && pdfData && printableFeatures
                        ? await generateInvoicePdf({
                            data: { ...pdfData, ...savedInvoice, id: savedInvoice.id, invoiceid: savedInvoice.invoiceid, sequenceId: savedInvoice.sequenceId },
                            format: printFormat,
                            workspaceId: workspaceId || '',
                            features: { ...printableFeatures, logo_url: printableFeatures?.logo_url || undefined },
                            workspaceName: workspaceName || workspaceId || '',
                            translations,
                            workspaceFooterContacts
                        })
                        : activeBlob)

                    const path = `${workspaceId}/printed-invoices/${printFormat === 'a4' ? 'A4' : 'receipts'}/${savedInvoice.id}.pdf`
                    await assetManager.uploadInvoicePdf(savedInvoice.id, finalBlob, printFormat, path)

                    const { error: upsertError } = await runSupabaseAction('printPreview.upsertInvoiceR2Path', () =>
                        supabase.from('invoices').upsert({
                            id: savedInvoice.id,
                            user_id: user?.id,
                            workspace_id: workspaceId,
                            invoiceid: savedInvoice.invoiceid,
                            total_amount: savedInvoice.totalAmount,
                            total: savedInvoice.totalAmount,
                            settlement_currency: savedInvoice.settlementCurrency,
                            print_format: printFormat,
                            updated_at: new Date().toISOString(),
                            ...(printFormat === 'a4' ? { r2_path_a4: path } : { r2_path_receipt: path })
                        })
                    )
                    if (upsertError) throw normalizeSupabaseActionError(upsertError)

                    const dbUpdate: any = { syncStatus: 'synced', lastSyncedAt: new Date().toISOString() }
                    if (printFormat === 'a4') { dbUpdate.r2PathA4 = path; dbUpdate.pdfBlobA4 = undefined }
                    else { dbUpdate.r2PathReceipt = path; dbUpdate.pdfBlobReceipt = undefined }
                    await db.invoices.update(savedInvoice.id, dbUpdate)
                } catch (uploadError) {
                    console.error('PDF upload failed:', uploadError)
                    if (!navigator.onLine) {
                        await db.invoices.update(savedInvoice.id, { syncStatus: 'pending', lastSyncedAt: null })
                        toast({ title: t('print.saveError') || 'Save Failed', description: 'PDF upload failed. It will retry when online.', variant: 'destructive' })
                    } else throw normalizeSupabaseActionError(uploadError)
                }
            }

            if (savedInvoice) {
                toast({
                    title: t('print.saveSuccess') || 'Invoice Saved',
                    description: t('print.saveSuccessDesc') || 'A record of this invoice has been added to history.'
                })
            }

            if (onConfirm) onConfirm()
        } catch (error) {
            console.error('Error saving invoice snapshot:', error)
            const normalized = normalizeSupabaseActionError(error)
            toast({
                title: isRetriableWebRequestError(normalized) ? getRetriableActionToast(normalized).title : (t('print.saveError') || 'Save Failed'),
                description: isRetriableWebRequestError(normalized) ? getRetriableActionToast(normalized).description : (t('print.saveErrorDesc') || 'Could not save invoice record.'),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }, [
        effectiveId,
        ensureSaveBlob,
        handleHtmlPrint,
        hasPdfData,
        invoiceData,
        isSaving,
        onConfirm,
        pdfBuilder,
        pdfData,
        printFormat,
        printableFeatures,
        t,
        toast,
        translations,
        user?.id,
        usesLocalInvoiceStorage,
        workspaceFooterContacts,
        workspaceId,
        workspaceName
    ])

    const handleOpenPreview = useCallback(async () => {
        try {
            const hasPdfDataForPreview = !!pdfData
            const hasPdfBuilder = !!pdfBuilder

            if (hasPdfDataForPreview) {
                const generatePdfBlob = async (editedData: any, printLangOverride?: string): Promise<Blob> => {
                    const dataToUse = editedData || pdfData
                    if (pdfBuilder) {
                        return await pdfBuilder({ format: printFormat, effectiveId, printLangOverride })
                    }
                    if (!dataToUse || !printableFeatures) throw new Error('Missing PDF data')
                    const effectiveLang = printLangOverride || printLang
                    return await generateInvoicePdf({
                        data: { ...dataToUse, id: effectiveId },
                        format: printFormat,
                        workspaceId: workspaceId || '',
                        features: { 
                            ...printableFeatures, 
                            logo_url: printableFeatures.logo_url || undefined,
                            print_lang: effectiveLang
                        },
                        workspaceName: workspaceName || workspaceId || '',
                        translations,
                        workspaceFooterContacts
                    })
                }

                setInvoicePreviewSource({
                    data: pdfData || { id: effectiveId, items: [], total_amount: 0, settlement_currency: 'usd', created_at: new Date().toISOString() },
                    features: printableFeatures || {},
                    workspaceId,
                    workspaceName: workspaceName || undefined,
                    workspaceFooterContacts,
                    printFormat,
                    title: title || t('print.previewTitle') || 'Print Preview',
                    onSave: showSaveButton ? handleSave : undefined,
                    invoiceData,
                    effectiveId,
                    generatePdfBlob,
                })
            } else if (hasPdfBuilder) {
                if (templatePreviewProp) {
                    setInvoicePreviewSource({
                        title: title || t('print.previewTitle') || 'Print Preview',
                        onSave: showSaveButton || enableTemplatePreviewSave ? handleSave : undefined,
                        effectiveId,
                        workspaceId,
                        templatePreview: templatePreviewProp,
                        customTemplate,
                        templateFieldValues,
                        initialTemplateLayout,
                        allowTemplateFieldEditing,
                        templatePrimaryActionLabel,
                        generateTemplateLayoutBlob,
                    })
                } else {
                    const blobs = await buildPdfBlobs(printFormat)
                    const blob = printFormat === 'receipt' ? blobs.receipt : blobs.a4
                    if (!blob) throw new Error('Failed to generate PDF')
                    const url = await blobToDataUrl(blob)
                    setInvoicePreviewSource({
                        url,
                        title: title || t('print.previewTitle') || 'Print Preview',
                        onSave: showSaveButton ? handleSave : undefined,
                    })
                }
            }

            setLocation('/pdf-preview')
        } catch (err) {
            console.error('Failed to open preview:', err)
        }
    }, [printFormat, printLang, title, t, setLocation, handleSave, pdfData, printableFeatures, workspaceId, workspaceName, workspaceFooterContacts, invoiceData, effectiveId, pdfBuilder, translations, buildPdfBlobs, blobToDataUrl, templatePreviewProp, customTemplate, templateFieldValues, initialTemplateLayout, allowTemplateFieldEditing, enableTemplatePreviewSave, templatePrimaryActionLabel, generateTemplateLayoutBlob, showSaveButton])

    const actionLabel = saveButtonText
        || (invoiceData ? (t('print.printAndSave') || 'Print & Save') : (t('common.print') || 'Print'))

    return (
        <>
            <PrintSelectionModal
                isOpen={isOpen && selectedPrintFormat === null}
                onClose={onClose}
                onSelect={handlePrintSelection}
                nativeOptions={resolvedPrintSelectionOptions}
                templateOptions={printSelectionTemplates}
            />
            <Dialog
                open={isOpen && selectedPrintFormat !== null}
                onOpenChange={(open) => !open && onClose()}
            >
                <DialogContent className="flex flex-col max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-primary" />
                        {title || t('print.previewTitle') || 'Print Preview'}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {hasPdfData ? (
                        <div className="border rounded-lg bg-muted/30 p-6 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">
                                {t('print.openFullPreview') || 'Open the full PDF viewer to preview, zoom, and navigate the document.'}
                            </p>
                            <Button 
                                onClick={handleOpenPreview} 
                                className="w-full"
                                disabled={!canPrint}
                            >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                {t('print.openPreview') || 'Open Full Preview'}
                            </Button>
                        </div>
                    ) : (
                        <div
                            ref={htmlPrintRef}
                            className="border rounded-lg bg-white dark:bg-zinc-900 p-4 max-h-60 overflow-auto"
                        >
                            {children}
                        </div>
                    )}
                </div>

                <DialogFooter className="shrink-0 pt-2">
                    <Button variant="outline" onClick={onClose}>
                        <X className="w-4 h-4 mr-2" />
                        {t('common.cancel')}
                    </Button>
                    {showSaveButton && (
                        <Button 
                            onClick={() => handleSave()} 
                            disabled={isSaving || !canPrint}
                        >
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4 mr-2" />
                            )}
                            {actionLabel}
                        </Button>
                    )}
                </DialogFooter>

                {hasPdfData && templateContent && (
                    <div className="fixed left-[-10000px] top-0">
                        <div ref={templatePrintRef} className="bg-white text-black">
                            {templateContent}
                        </div>
                    </div>
                )}
                </DialogContent>
            </Dialog>
        </>
    )
}
