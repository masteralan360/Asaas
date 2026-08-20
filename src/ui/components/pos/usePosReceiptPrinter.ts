import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/ui/components'
import { isSupabaseConfigured, useAuth } from '@/auth'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'
import { disableInvoiceQrInLocalMode } from '@/services/localInvoiceStorage'
import { generateInvoicePdf } from '@/services/pdfGenerator'
import { printPdfBlob } from '@/services/pdfPrintService'
import { renderPdfPageToPngDataUrl } from '@/services/pdfRasterizer'
import { printService } from '@/services/printService'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import {
    SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
    buildCustomTemplateLayoutPdf,
    getCustomTemplateTarget,
    isCustomTemplatePrintLanguageCompatible,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'
import type { UniversalInvoice } from '@/types'

interface UsePosReceiptPrinterOptions {
    saleData: UniversalInvoice | null | undefined
    features: WorkspaceFeatures
    /** Enables loading the primary receipt template while the caller is active. */
    enabled: boolean
    /** Uses a source-specific receipt while retaining the normal POS direct-print flow. */
    receiptPdfBuilder?: () => Promise<Blob>
}

interface PrintPosReceiptOptions {
    title?: string
    /** Allows callers to share one PDF between receipt sync and printing. */
    pdfBuilder?: () => Promise<Blob>
}

/**
 * The POS receipt pipeline shared by completed sales and cart pre-prints.
 * It intentionally contains no sale persistence or invoice synchronization.
 */
export function usePosReceiptPrinter({
    saleData,
    features,
    enabled,
    receiptPdfBuilder
}: UsePosReceiptPrinterOptions) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { workspaceName, activeWorkspace, isLocalMode } = useWorkspace()
    const { toast } = useToast()
    const [primaryReceiptTemplate, setPrimaryReceiptTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [isLoadingPrimaryReceiptTemplate, setIsLoadingPrimaryReceiptTemplate] = useState(false)
    const [resolvedPrimaryTemplateKey, setResolvedPrimaryTemplateKey] = useState<string | null>(null)

    const workspaceId = activeWorkspace?.id || user?.workspaceId || ''
    const resolvedWorkspaceName = workspaceName || workspaceId || 'Atlas'
    const printFeatures = useMemo(
        () => disableInvoiceQrInLocalMode(workspaceId, features),
        [features, workspaceId]
    )
    const currentTemplatePrintLanguage = resolveCustomTemplatePrintLanguage(
        printFeatures.print_lang,
        i18n.language
    )
    const shouldLoadPrimaryReceiptTemplate = !receiptPdfBuilder
        && enabled
        && !!workspaceId
        && (isLocalMode || isSupabaseConfigured)
    const primaryTemplateLookupKey = `${workspaceId}:${currentTemplatePrintLanguage}`

    useEffect(() => {
        if (!shouldLoadPrimaryReceiptTemplate) {
            setPrimaryReceiptTemplate(null)
            setIsLoadingPrimaryReceiptTemplate(false)
            setResolvedPrimaryTemplateKey(null)
            return
        }

        let cancelled = false
        setIsLoadingPrimaryReceiptTemplate(true)
        void (async () => {
            try {
                const templates = await fetchCachedCustomTemplates(workspaceId, {
                    moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
                    activeOnly: true,
                    primaryOnly: true,
                })
                const primaryTemplate = templates.find((template) =>
                    isCustomTemplatePrintLanguageCompatible(
                        template as StoredCustomTemplateRow,
                        currentTemplatePrintLanguage,
                    )
                ) || null
                if (!cancelled) setPrimaryReceiptTemplate(primaryTemplate as StoredCustomTemplateRow | null)
            } catch (templateError) {
                console.error('[usePosReceiptPrinter] Failed to load primary receipt template:', templateError)
                if (!cancelled) setPrimaryReceiptTemplate(null)
            } finally {
                if (!cancelled) {
                    setIsLoadingPrimaryReceiptTemplate(false)
                    setResolvedPrimaryTemplateKey(primaryTemplateLookupKey)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [currentTemplatePrintLanguage, primaryTemplateLookupKey, shouldLoadPrimaryReceiptTemplate, workspaceId])

    const primaryReceiptTarget = useMemo(
        () => getCustomTemplateTarget(SALES_HISTORY_RECEIPT_TEMPLATE_KEY),
        []
    )
    const primaryReceiptLayout = useMemo(
        () => primaryReceiptTemplate
            && isCustomTemplatePrintLanguageCompatible(primaryReceiptTemplate, currentTemplatePrintLanguage)
            ? readCustomTemplateLayout(primaryReceiptTemplate)
            : null,
        [currentTemplatePrintLanguage, primaryReceiptTemplate]
    )

    const buildReceiptPdf = useCallback(async () => {
        if (!saleData) {
            throw new Error('Receipt data is not available.')
        }

        if (receiptPdfBuilder) {
            return receiptPdfBuilder()
        }

        if (primaryReceiptTarget && primaryReceiptLayout) {
            return buildCustomTemplateLayoutPdf({
                target: primaryReceiptTarget,
                layout: primaryReceiptLayout,
                values: {},
                options: {
                    workspaceId,
                    workspaceName,
                    features: printFeatures,
                    receiptData: saleData
                },
                effectiveId: saleData.id
            })
        }

        return generateInvoicePdf({
            data: { ...saleData },
            format: 'receipt',
            features: printFeatures,
            workspaceName: resolvedWorkspaceName,
            workspaceId
        })
    }, [primaryReceiptLayout, primaryReceiptTarget, printFeatures, receiptPdfBuilder, resolvedWorkspaceName, saleData, workspaceId, workspaceName])

    const printReceipt = useCallback(async ({
        title = `Receipt_${saleData?.invoiceid || saleData?.id || 'Sale'}`,
        pdfBuilder = buildReceiptPdf
    }: PrintPosReceiptOptions = {}) => {
        let handledByThermalPrinter = false
        if (features.thermal_printing) {
            try {
                const maxWidth = await printService.getThermalPrinterMaxWidth(workspaceId)
                const receiptPdf = await pdfBuilder()
                const imageBase64 = await renderPdfPageToPngDataUrl(receiptPdf, { maxWidthPx: maxWidth })

                handledByThermalPrinter = await printService.silentPrintImage({
                    imageBase64,
                    workspaceId,
                    maxWidth
                })
            } catch (thermalError) {
                console.error('[usePosReceiptPrinter] Thermal print failed:', thermalError)
                toast({
                    title: t('settings.printing.thermalPrintErrorTitle', { defaultValue: 'Thermal printing failed' }),
                    description: t('settings.printing.thermalPrintErrorDesc', {
                        defaultValue: 'Falling back to the regular receipt print flow for this sale.'
                    }),
                    variant: 'destructive'
                })
            }
        }

        if (!handledByThermalPrinter) {
            await printPdfBlob(await pdfBuilder(), { title })
        }
    }, [buildReceiptPdf, features.thermal_printing, saleData?.id, saleData?.invoiceid, t, toast, workspaceId])

    return {
        buildReceiptPdf,
        isLoadingPrimaryReceiptTemplate: isLoadingPrimaryReceiptTemplate
            || (shouldLoadPrimaryReceiptTemplate && resolvedPrimaryTemplateKey !== primaryTemplateLookupKey),
        printFeatures,
        printReceipt,
        resolvedWorkspaceName,
        workspaceId,
    }
}
