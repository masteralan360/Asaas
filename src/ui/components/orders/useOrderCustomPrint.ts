import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

import { isSupabaseConfigured } from '@/auth'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import {
    buildCustomTemplateLayoutPdf,
    createCustomTemplatePreview,
    getCustomTemplatePrintLanguageWarning,
    getCustomTemplateTarget,
    getStoredCustomTemplateLabel,
    isCustomTemplatePrintLanguageCompatible,
    ORDER_ATLAS_STANDARD_TEMPLATE_KEY,
    ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY,
    ORDER_DETAILS_TEMPLATE_KEY,
    ORDER_RECEIPT_TEMPLATE_KEY,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'
import type { CustomTemplateLayout } from '@/lib/pdfPreviewStore'
import type { OrderInstallment, PurchaseOrder, SalesOrder } from '@/local-db'
import type { SalesOrderReturnPrintData } from '@/lib/orderReturnPrintData'
import type { OrderPrintVersion } from '@/lib/orderPrintReturnState'
import { useBusinessPartner } from '@/local-db'
import type { PrintFormat } from '@/services/pdfGenerator'
import type { WorkspaceFeatures } from '@/workspace'

import type { ProductPrintImageUrls } from '@/ui/components/print/ProductPrintImage'

type OrderKind = 'sales' | 'purchase'
type OrderNativeTemplateKey = typeof ORDER_ATLAS_STANDARD_TEMPLATE_KEY
    | typeof ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
    | typeof ORDER_DETAILS_TEMPLATE_KEY
    | typeof ORDER_RECEIPT_TEMPLATE_KEY

interface UseOrderCustomPrintOptions {
    workspaceId: string
    workspaceName?: string | null
    features: WorkspaceFeatures
    isLocalMode: boolean
    isOpen: boolean
    printLanguage: string
    order?: SalesOrder | PurchaseOrder
    orderKind?: OrderKind
    returnPrintData?: SalesOrderReturnPrintData | null
    installments: OrderInstallment[]
    productUnits?: Record<string, string | null | undefined>
    productImageUrls?: ProductPrintImageUrls
    printedBy?: string | null
    t: TFunction
}

export function useOrderCustomPrint({
    workspaceId,
    workspaceName,
    features,
    isLocalMode,
    isOpen,
    printLanguage,
    order,
    orderKind,
    returnPrintData,
    installments,
    productUnits,
    productImageUrls,
    printedBy,
    t
}: UseOrderCustomPrintOptions) {
    const [templates, setTemplates] = useState<StoredCustomTemplateRow[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [selectedNativeTemplateKey, setSelectedNativeTemplateKey] = useState<OrderNativeTemplateKey>(ORDER_ATLAS_STANDARD_TEMPLATE_KEY)
    const [selectedPrintVersion, setSelectedPrintVersion] = useState<OrderPrintVersion>('adjusted')
    const currentPrintLanguage = resolveCustomTemplatePrintLanguage(features.print_lang, printLanguage)
    const partnerId = order?.businessPartnerId
        || (orderKind === 'sales' ? (order as SalesOrder)?.customerId : (order as PurchaseOrder)?.supplierId)
    const bizPartner = useBusinessPartner(partnerId)
    const counterpartyPhone = bizPartner?.phone || ''
    const counterpartyAddress = bizPartner?.address || ''

    useEffect(() => {
        if (!isOpen || (!isLocalMode && !isSupabaseConfigured)) {
            setTemplates([])
            return
        }

        let cancelled = false
        void (async () => {
            try {
                const rows = await fetchCachedCustomTemplates(workspaceId, {
                    activeOnly: true
                })
                if (!cancelled) setTemplates(rows as StoredCustomTemplateRow[])
            } catch (error) {
                console.error('[Orders] Failed to load custom order templates:', error)
                if (!cancelled) setTemplates([])
            }
        })()

        return () => {
            cancelled = true
        }
    }, [isLocalMode, isOpen, workspaceId])

    useEffect(() => {
        if (!isOpen) {
            setSelectedTemplate(null)
            setSelectedNativeTemplateKey(ORDER_ATLAS_STANDARD_TEMPLATE_KEY)
            setSelectedPrintVersion('adjusted')
        }
    }, [isOpen])

    const hasReturnPrintData = orderKind === 'sales' && Boolean(returnPrintData?.lines.length)
    const availableTemplates = useMemo(
        () => templates.filter((template) =>
            (template.module_type_key === ORDER_ATLAS_STANDARD_TEMPLATE_KEY
                || template.module_type_key === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
                || template.module_type_key === ORDER_DETAILS_TEMPLATE_KEY
                || template.module_type_key === ORDER_RECEIPT_TEMPLATE_KEY)
            && (template.module_type_key !== ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY || hasReturnPrintData)
            && template.active
            && Boolean(readCustomTemplateLayout(template))
        ),
        [hasReturnPrintData, templates]
    )
    const selectedTemplateTarget = useMemo(
        () => selectedTemplate ? getCustomTemplateTarget(selectedTemplate.module_type_key) : undefined,
        [selectedTemplate]
    )
    const selectedLayout = useMemo(
        () => selectedTemplate
            && isCustomTemplatePrintLanguageCompatible(selectedTemplate, currentPrintLanguage)
            ? readCustomTemplateLayout(selectedTemplate)
            : null,
        [currentPrintLanguage, selectedTemplate]
    )
    const isCustomSelected = Boolean(selectedTemplate && selectedLayout)
    const isReceiptSelected = !isCustomSelected && selectedNativeTemplateKey === ORDER_RECEIPT_TEMPLATE_KEY
    const isAtlasStandardSelected = !isCustomSelected && selectedNativeTemplateKey === ORDER_ATLAS_STANDARD_TEMPLATE_KEY
    const isAtlasStandardReturnSelected = !isCustomSelected && selectedNativeTemplateKey === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
    const isReturnPrintSelected = selectedPrintVersion === 'returned'
        && (isAtlasStandardReturnSelected
            || selectedTemplateTarget?.moduleTypeKey === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY)
    const isOriginalPrintSelected = selectedPrintVersion === 'original'
    const preview = useMemo(() => {
        if (!selectedTemplateTarget || !order || !orderKind || !isCustomSelected) return undefined

        return createCustomTemplatePreview(selectedTemplateTarget, {
            workspaceId,
            workspaceName,
            features,
            order,
            orderKind,
            orderReturnPrintData: returnPrintData,
            orderPrintVersion: selectedPrintVersion,
            orderInstallments: installments,
            businessPartner: bizPartner,
            productUnits,
            productImageUrls,
            counterpartyPhone,
            counterpartyAddress,
            printedBy,
            printLang: currentPrintLanguage
        })
    }, [bizPartner, currentPrintLanguage, features, installments, isCustomSelected, order, orderKind, printedBy, productImageUrls, productUnits, returnPrintData, selectedPrintVersion, selectedTemplateTarget, workspaceId, workspaceName, counterpartyPhone, counterpartyAddress])

    const buildPdf = useCallback(async ({
        effectiveId,
        printLangOverride
    }: {
        format: PrintFormat
        effectiveId: string
        printLangOverride?: string
    }) => {
        if (!selectedTemplateTarget || !selectedLayout || !order || !orderKind) {
            throw new Error('Custom order template is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target: selectedTemplateTarget,
            layout: selectedLayout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                order,
                orderKind,
                orderReturnPrintData: returnPrintData,
                orderPrintVersion: selectedPrintVersion,
                orderInstallments: installments,
                businessPartner: bizPartner,
                productUnits,
                productImageUrls,
                counterpartyPhone,
                counterpartyAddress,
                printedBy,
                printLang: printLangOverride || currentPrintLanguage
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [bizPartner, counterpartyAddress, counterpartyPhone, currentPrintLanguage, features, installments, order, orderKind, printedBy, productImageUrls, productUnits, returnPrintData, selectedLayout, selectedPrintVersion, selectedTemplateTarget, workspaceId, workspaceName])

    const buildEditablePdf = useCallback(async (
        layout: CustomTemplateLayout,
        printLangOverride?: string,
        effectiveId?: string
    ) => {
        if (!selectedTemplateTarget || !order || !orderKind) {
            throw new Error('Custom order template is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target: selectedTemplateTarget,
            layout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                order,
                orderKind,
                orderReturnPrintData: returnPrintData,
                orderPrintVersion: selectedPrintVersion,
                orderInstallments: installments,
                businessPartner: bizPartner,
                productUnits,
                productImageUrls,
                counterpartyPhone,
                counterpartyAddress,
                printedBy,
                printLang: printLangOverride || currentPrintLanguage
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [bizPartner, counterpartyAddress, counterpartyPhone, currentPrintLanguage, features, installments, order, orderKind, printedBy, productImageUrls, productUnits, returnPrintData, selectedPrintVersion, selectedTemplateTarget, workspaceId, workspaceName])

    const nativeOptions = useMemo(() => [
        {
            format: 'a4' as const,
            label: 'Atlas Standard',
            returnsReflected: hasReturnPrintData,
            description: t('orders.print.nativeA4TemplateDescription', {
                defaultValue: 'Use the built-in Atlas Standard order invoice A4 layout.'
            })
        },
        {
            format: 'receipt' as const,
            label: t('orders.print.nativeReceiptTemplate', { defaultValue: 'Orders - Receipt Print' }),
            returnsReflected: hasReturnPrintData,
            description: t('orders.print.nativeReceiptTemplateDescription', {
                defaultValue: 'Use the built-in compact order receipt layout.'
            })
        },
        ...(hasReturnPrintData ? [{
            format: 'a4' as const,
            nativeTemplateKey: ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY,
            returned: true,
            label: t('orders.print.nativeReturnTemplate', { defaultValue: 'Atlas Standard Return' }),
            description: t('orders.print.nativeReturnTemplateDescription', {
                defaultValue: 'Print only the returned items and their refunded amounts.'
            })
        }] : [])
    ], [hasReturnPrintData, t])
    const templateOptions = useMemo(
        () => availableTemplates.map((template) => ({
            format: template.module_type_key === ORDER_RECEIPT_TEMPLATE_KEY ? 'receipt' as const : 'a4' as const,
            template,
            label: getStoredCustomTemplateLabel(template),
            description: template.module_type_key === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
                ? t('orders.print.customReturnTemplateDescription', {
                    defaultValue: 'Use this saved layout for partial and fully returned orders.'
                })
                : template.module_type_key === ORDER_RECEIPT_TEMPLATE_KEY
                ? t('orders.print.customReceiptTemplateDescription', {
                    defaultValue: 'Use this saved custom order receipt layout.'
                })
                : t('orders.print.customA4TemplateDescription', {
                    defaultValue: 'Use this saved custom order details layout.'
                }),
            primary: template.primary,
            returned: template.module_type_key === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY,
            returnsReflected: hasReturnPrintData
                && template.module_type_key !== ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY,
            disabled: !isCustomTemplatePrintLanguageCompatible(template, currentPrintLanguage),
            warning: getCustomTemplatePrintLanguageWarning(template, currentPrintLanguage, t)
        })),
        [availableTemplates, currentPrintLanguage, hasReturnPrintData, t]
    )
    const handleSelection = useCallback((
        _format: PrintFormat,
        template?: StoredCustomTemplateRow,
        nativeTemplateKey?: string,
        printVersion: OrderPrintVersion = 'adjusted'
    ) => {
        if (template && !isCustomTemplatePrintLanguageCompatible(template, currentPrintLanguage)) {
            return
        }
        setSelectedTemplate(template || null)
        const selectedTemplateIsReturn = template?.module_type_key === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
        const selectedNativeIsReturn = nativeTemplateKey === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
        setSelectedPrintVersion(
            (selectedTemplateIsReturn || selectedNativeIsReturn) && hasReturnPrintData
                ? 'returned'
                : printVersion === 'returned' ? 'adjusted' : printVersion
        )
        if (!template) {
            setSelectedNativeTemplateKey(
                nativeTemplateKey === ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY && hasReturnPrintData
                    ? ORDER_ATLAS_STANDARD_RETURN_TEMPLATE_KEY
                    : _format === 'receipt' ? ORDER_RECEIPT_TEMPLATE_KEY : ORDER_ATLAS_STANDARD_TEMPLATE_KEY
            )
        }
    }, [currentPrintLanguage, hasReturnPrintData])
    const resetSelection = useCallback(() => {
        setSelectedTemplate(null)
        setSelectedNativeTemplateKey(ORDER_ATLAS_STANDARD_TEMPLATE_KEY)
        setSelectedPrintVersion('adjusted')
    }, [])

    return {
        selectedTemplateLabel: selectedTemplate ? getStoredCustomTemplateLabel(selectedTemplate) : undefined,
        isCustomSelected,
        isReceiptSelected,
        isAtlasStandardSelected,
        isAtlasStandardReturnSelected,
        isReturnPrintSelected,
        isOriginalPrintSelected,
        selectedPrintVersion,
        preview,
        buildPdf,
        buildEditablePdf,
        initialLayout: isCustomSelected ? selectedLayout : undefined,
        customTemplate: isCustomSelected && selectedTemplate && selectedTemplateTarget ? {
            moduleTypeKey: selectedTemplateTarget.moduleTypeKey,
            nativeTemplateKey: selectedTemplateTarget.nativeTemplateKey,
            templateId: selectedTemplate.id,
            label: getStoredCustomTemplateLabel(selectedTemplate)
        } : undefined,
        nativeOptions,
        templateOptions,
        handleSelection,
        resetSelection
    }
}
