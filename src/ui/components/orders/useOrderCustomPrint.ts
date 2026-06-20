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
    ORDER_DETAILS_TEMPLATE_KEY,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'
import type { CustomTemplateLayout } from '@/lib/pdfPreviewStore'
import type { OrderInstallment, PurchaseOrder, SalesOrder } from '@/local-db'
import type { PrintFormat } from '@/services/pdfGenerator'
import type { WorkspaceFeatures } from '@/workspace'

type OrderKind = 'sales' | 'purchase'

interface UseOrderCustomPrintOptions {
    workspaceId: string
    workspaceName?: string | null
    features: WorkspaceFeatures
    isLocalMode: boolean
    isOpen: boolean
    printLanguage: string
    order?: SalesOrder | PurchaseOrder
    orderKind?: OrderKind
    installments: OrderInstallment[]
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
    installments,
    t
}: UseOrderCustomPrintOptions) {
    const [templates, setTemplates] = useState<StoredCustomTemplateRow[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const currentPrintLanguage = resolveCustomTemplatePrintLanguage(features.print_lang, printLanguage)
    const target = useMemo(() => getCustomTemplateTarget(ORDER_DETAILS_TEMPLATE_KEY), [])

    useEffect(() => {
        if (!isOpen || (!isLocalMode && !isSupabaseConfigured)) {
            setTemplates([])
            return
        }

        let cancelled = false
        void (async () => {
            try {
                const rows = await fetchCachedCustomTemplates(workspaceId, {
                    moduleTypeKey: ORDER_DETAILS_TEMPLATE_KEY,
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
        if (!isOpen) setSelectedTemplate(null)
    }, [isOpen])

    const availableTemplates = useMemo(
        () => templates.filter((template) =>
            template.module_type_key === ORDER_DETAILS_TEMPLATE_KEY
            && template.active
            && Boolean(readCustomTemplateLayout(template))
        ),
        [templates]
    )
    const selectedLayout = useMemo(
        () => selectedTemplate
            && isCustomTemplatePrintLanguageCompatible(selectedTemplate, currentPrintLanguage)
            ? readCustomTemplateLayout(selectedTemplate)
            : null,
        [currentPrintLanguage, selectedTemplate]
    )
    const isCustomSelected = Boolean(selectedTemplate && selectedLayout)
    const preview = useMemo(() => {
        if (!target || !order || !orderKind) return undefined

        return createCustomTemplatePreview(target, {
            workspaceId,
            workspaceName,
            features,
            order,
            orderKind,
            orderInstallments: installments,
            printLang: currentPrintLanguage
        })
    }, [currentPrintLanguage, features, installments, order, orderKind, target, workspaceId, workspaceName])

    const buildPdf = useCallback(async ({
        effectiveId,
        printLangOverride
    }: {
        format: PrintFormat
        effectiveId: string
        printLangOverride?: string
    }) => {
        if (!target || !selectedLayout || !order || !orderKind) {
            throw new Error('Custom order template is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target,
            layout: selectedLayout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                order,
                orderKind,
                orderInstallments: installments,
                printLang: printLangOverride || currentPrintLanguage
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [currentPrintLanguage, features, installments, order, orderKind, selectedLayout, target, workspaceId, workspaceName])

    const buildEditablePdf = useCallback(async (
        layout: CustomTemplateLayout,
        printLangOverride?: string,
        effectiveId?: string
    ) => {
        if (!target || !order || !orderKind) {
            throw new Error('Custom order template is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target,
            layout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                order,
                orderKind,
                orderInstallments: installments,
                printLang: printLangOverride || currentPrintLanguage
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [currentPrintLanguage, features, installments, order, orderKind, target, workspaceId, workspaceName])

    const nativeOptions = useMemo(() => [{
        format: 'a4' as const,
        label: t('orders.print.nativeA4Template', { defaultValue: 'Order A4' }),
        description: t('orders.print.nativeA4TemplateDescription', {
            defaultValue: 'Use the built-in order details A4 layout.'
        })
    }], [t])
    const templateOptions = useMemo(
        () => availableTemplates.map((template) => ({
            format: 'a4' as const,
            template,
            label: getStoredCustomTemplateLabel(template),
            description: t('orders.print.customA4TemplateDescription', {
                defaultValue: 'Use this saved custom order details layout.'
            }),
            primary: template.primary,
            disabled: !isCustomTemplatePrintLanguageCompatible(template, currentPrintLanguage),
            warning: getCustomTemplatePrintLanguageWarning(template, currentPrintLanguage, t)
        })),
        [availableTemplates, currentPrintLanguage, t]
    )
    const handleSelection = useCallback((
        _format: PrintFormat,
        template?: StoredCustomTemplateRow
    ) => {
        if (template && !isCustomTemplatePrintLanguageCompatible(template, currentPrintLanguage)) {
            return
        }
        setSelectedTemplate(template || null)
    }, [currentPrintLanguage])
    const resetSelection = useCallback(() => setSelectedTemplate(null), [])

    return {
        selectedTemplateLabel: selectedTemplate ? getStoredCustomTemplateLabel(selectedTemplate) : undefined,
        isCustomSelected,
        preview,
        buildPdf,
        buildEditablePdf,
        initialLayout: isCustomSelected ? selectedLayout : undefined,
        customTemplate: isCustomSelected && selectedTemplate && target ? {
            moduleTypeKey: target.moduleTypeKey,
            nativeTemplateKey: target.nativeTemplateKey,
            templateId: selectedTemplate.id,
            label: getStoredCustomTemplateLabel(selectedTemplate)
        } : undefined,
        nativeOptions,
        templateOptions,
        handleSelection,
        resetSelection
    }
}
