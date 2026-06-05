import { generateTemplatePdf } from '@/services/pdfGenerator'
import type { CustomTemplateLayout, TemplatePreview, TemplatePreviewDataKey } from '@/lib/pdfPreviewStore'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { platformService } from '@/services/platformService'
import {
    getRealEstateNativeFieldPlaceholders,
    getRealEstateNativeTemplateFieldLabels,
    getRealEstateTemplateKeyLabels,
    getRealEstateTransactionTypeFromModuleTypeKey
} from '@/lib/realEstateParties'
import {
    RealEstateBuyPrintTemplate,
    type WorkspaceFooterContacts
} from '@/ui/components/real-estate/RealEstateBuyPrintTemplate'
import type { RealEstateTransactionType } from '@/local-db'
import type { WorkspaceFeatures } from '@/workspace'

export type CustomTemplateTarget = {
    moduleTypeKey: string
    workspaceModuleKey: 'real_estate'
    moduleLabel: string
    typeLabel: string
    description: string
    nativeTemplateKey: string
    nativeTemplateAvailable: boolean
}

const REAL_ESTATE_CONTRACT_TARGETS: Array<Pick<CustomTemplateTarget, 'moduleTypeKey' | 'typeLabel' | 'description' | 'nativeTemplateKey' | 'nativeTemplateAvailable'>> = [
    {
        moduleTypeKey: 'realEstate.Sell',
        typeLabel: 'Sell',
        description: 'Real estate sell transaction print layout.',
        nativeTemplateKey: 'realEstate.Sell',
        nativeTemplateAvailable: true
    },
    {
        moduleTypeKey: 'realEstate.Buy',
        typeLabel: 'Buy',
        description: 'Real estate buy transaction print layout.',
        nativeTemplateKey: 'realEstate.Buy',
        nativeTemplateAvailable: true
    },
    {
        moduleTypeKey: 'realEstate.Rent',
        typeLabel: 'Rent',
        description: 'Real estate rent transaction print layout.',
        nativeTemplateKey: 'realEstate.Rent',
        nativeTemplateAvailable: true
    },
    {
        moduleTypeKey: 'realEstate.Lease',
        typeLabel: 'Lease',
        description: 'Real estate lease transaction print layout.',
        nativeTemplateKey: 'realEstate.Lease',
        nativeTemplateAvailable: true
    },
    {
        moduleTypeKey: 'realEstate.Exchange',
        typeLabel: 'Exchange',
        description: 'Real estate exchange transaction print layout.',
        nativeTemplateKey: 'realEstate.Exchange',
        nativeTemplateAvailable: true
    }
]

const REAL_ESTATE_CONTRACT_MODULE_TYPE_KEYS = new Set(
    REAL_ESTATE_CONTRACT_TARGETS.map((target) => target.moduleTypeKey)
)

export const CUSTOM_TEMPLATE_TARGETS: CustomTemplateTarget[] = [
    ...REAL_ESTATE_CONTRACT_TARGETS.map((target) => ({
        ...target,
        workspaceModuleKey: 'real_estate' as const,
        moduleLabel: 'Real Estate'
    }))
]

export function getCustomTemplateTarget(moduleTypeKey: string) {
    return CUSTOM_TEMPLATE_TARGETS.find((target) => target.moduleTypeKey === moduleTypeKey)
}

export function getCustomTemplateDisplayName(moduleTypeKey: string) {
    const target = getCustomTemplateTarget(moduleTypeKey)
    if (target) {
        return `${target.moduleLabel} - ${target.typeLabel}`
    }

    return moduleTypeKey
}

export type StoredCustomTemplateRow = {
    id: string
    module_type_key: string
    label?: string | null
    layout_json: unknown
    updated_at?: string | null
}

export function readCustomTemplateLayout(row?: StoredCustomTemplateRow | null): CustomTemplateLayout | null {
    if (!row || !row.layout_json || typeof row.layout_json !== 'object') return null

    const layout = row.layout_json as Partial<CustomTemplateLayout>

    return {
        version: 1,
        label: row.label?.trim() || (typeof layout.label === 'string' ? layout.label : undefined),
        moduleTypeKey: typeof layout.moduleTypeKey === 'string' ? layout.moduleTypeKey : row.module_type_key,
        nativeTemplateKey: typeof layout.nativeTemplateKey === 'string' ? layout.nativeTemplateKey : undefined,
        page: {
            widthMm: layout.page?.widthMm || 210,
            heightMm: layout.page?.heightMm || 297
        },
        fields: layout.fields || {},
        annotations: layout.annotations || [],
        texts: layout.texts || [],
        images: layout.images || [],
        updatedAt: typeof layout.updatedAt === 'string' ? layout.updatedAt : row.updated_at || new Date().toISOString()
    }
}

export function countCustomTemplateLayoutItems(row: StoredCustomTemplateRow) {
    const layout = readCustomTemplateLayout(row)
    if (!layout) return 0
    return layout.annotations.length + layout.texts.length + layout.images.length + Object.keys(layout.fields).length
}

export function getStoredCustomTemplateLabel(row: StoredCustomTemplateRow) {
    const layout = readCustomTemplateLayout(row)
    return row.label?.trim() || layout?.label || getCustomTemplateDisplayName(row.module_type_key)
}

export type CustomTemplatePreviewOptions = {
    workspaceId?: string
    workspaceName?: string | null
    features?: WorkspaceFeatures
    workspaceFooterContacts?: WorkspaceFooterContacts
}

const REAL_ESTATE_BUY_FIELD_PLACEHOLDERS = {
    sellerWitnessName: 'ناوی شاهیدی فرۆشیار بنووسە',
    sellerWitnessAddress: 'ناونیشانی شاهیدی فرۆشیار بنووسە',
    sellerWitnessPhone: 'ژمارەی تەلەفۆنی شاهیدی فرۆشیار بنووسە',
    sellerSignatureName: 'ناوی فرۆشیار بنووسە',
    sellerSignatureAddress: 'ناونیشانی فرۆشیار بنووسە',
    sellerSignaturePhone: 'ژمارەی تەلەفۆنی فرۆشیار بنووسە',
    buyerSignatureName: 'ناوی کڕیار بنووسە',
    buyerSignatureAddress: 'ناونیشانی کڕیار بنووسە',
    buyerSignaturePhone: 'ژمارەی تەلەفۆنی کڕیار بنووسە',
    buyerWitnessName: 'ناوی شاهیدی کڕیار بنووسە',
    buyerWitnessAddress: 'ناونیشانی شاهیدی کڕیار بنووسە',
    buyerWitnessPhone: 'ژمارەی تەلەفۆنی شاهیدی کڕیار بنووسە'
}

export const REAL_ESTATE_BUY_TRANSACTION_KEYS: TemplatePreviewDataKey[] = [
    { key: 'transactionNo', label: '', group: 'Deal' },
    { key: 'transactionType', label: '', group: 'Deal' },
    { key: 'status', label: '', group: 'Deal' },
    { key: 'location', label: '', group: 'Property' },
    { key: 'propertyType', label: '', group: 'Property' },
    { key: 'landAreaM2', label: '', group: 'Property' },
    { key: 'currency', label: '', group: 'Amounts' },
    { key: 'totalAmount', label: '', group: 'Amounts' },
    { key: 'paidAmount', label: '', group: 'Amounts' },
    { key: 'balanceAmount', label: '', group: 'Amounts' },
    { key: 'profitAmount', label: '', group: 'Amounts' },
    { key: 'buyerName', label: '', group: 'Buyer' },
    { key: 'buyerPhone', label: '', group: 'Buyer' },
    { key: 'buyerBusinessPartnerId', label: '', group: 'Buyer' },
    { key: 'buyerWitnessName', label: '', group: 'Buyer' },
    { key: 'buyerWitnessAddress', label: '', group: 'Buyer' },
    { key: 'buyerWitnessPhone', label: '', group: 'Buyer' },
    { key: 'sellerName', label: '', group: 'Seller' },
    { key: 'sellerPhone', label: '', group: 'Seller' },
    { key: 'sellerBusinessPartnerId', label: '', group: 'Seller' },
    { key: 'sellerWitnessName', label: '', group: 'Seller' },
    { key: 'sellerWitnessAddress', label: '', group: 'Seller' },
    { key: 'sellerWitnessPhone', label: '', group: 'Seller' },
    { key: 'isInstallmentBased', label: '', group: 'Installments' },
    { key: 'installmentCount', label: '', group: 'Installments' },
    { key: 'installmentFrequency', label: '', group: 'Installments' },
    { key: 'firstDueDate', label: '', group: 'Installments' },
    { key: 'nextDueDate', label: '', group: 'Installments' },
    { key: 'notes', label: '', group: 'Deal' },
    { key: 'createdAt', label: '', group: 'System' },
    { key: 'updatedAt', label: '', group: 'System' }
]

const REAL_ESTATE_BUY_FIELDS = [
    { key: 'receiptNumber', label: 'ژمارەی وصل', value: '3', type: 'text' as const },
    { key: 'sellerName', label: 'ناوی فرۆشیار', value: '', type: 'text' as const },
    { key: 'sellerPhone', label: 'پەیاسی فرۆشیار', value: 'ناسراوه', type: 'text' as const },
    { key: 'buyerName', label: 'ناوی کڕیار', value: '', type: 'text' as const },
    { key: 'buyerPhone', label: 'پەیاسی کڕیار', value: 'ناسراوه', type: 'text' as const },
    { key: 'contractRow1', label: 'Row 1', value: '', type: 'text' as const },
    { key: 'contractRow2', label: 'Row 2', value: '', type: 'text' as const },
    { key: 'contractRow3', label: 'Row 3', value: '', type: 'text' as const },
    { key: 'contractRow4', label: 'Row 4', value: '', type: 'text' as const },
    { key: 'contractRow5', label: 'Row 5', value: '', type: 'text' as const },
    { key: 'contractRow6', label: 'Row 6', value: '', type: 'text' as const },
    { key: 'contractRow7', label: 'Row 7', value: '', type: 'text' as const },
    { key: 'contractRow8', label: 'Row 8', value: '', type: 'text' as const },
    { key: 'contractRow9', label: 'Row 9', value: '', type: 'text' as const },
    { key: 'contractRow10', label: 'Row 10', value: '', type: 'text' as const },
    { key: 'contractRow11', label: 'Row 11', value: '', type: 'text' as const },
    { key: 'sellerWitnessName', label: 'شاهیدی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerWitnessName },
    { key: 'sellerWitnessAddress', label: 'ناونیشانی شاهیدی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerWitnessAddress },
    { key: 'sellerWitnessPhone', label: 'ژمارەی شاهیدی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerWitnessPhone },
    { key: 'sellerSignatureName', label: 'واژۆی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerSignatureName },
    { key: 'sellerSignatureAddress', label: 'ناونیشانی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerSignatureAddress },
    { key: 'sellerSignaturePhone', label: 'ژمارەی فرۆشیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.sellerSignaturePhone },
    { key: 'buyerSignatureName', label: 'واژۆی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerSignatureName },
    { key: 'buyerSignatureAddress', label: 'ناونیشانی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerSignatureAddress },
    { key: 'buyerSignaturePhone', label: 'ژمارەی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerSignaturePhone },
    { key: 'buyerWitnessName', label: 'شاهیدی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerWitnessName },
    { key: 'buyerWitnessAddress', label: 'ناونیشانی شاهیدی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerWitnessAddress },
    { key: 'buyerWitnessPhone', label: 'ژمارەی شاهیدی کڕیار', value: '', type: 'text' as const, placeholder: REAL_ESTATE_BUY_FIELD_PLACEHOLDERS.buyerWitnessPhone },
    { key: 'note', label: 'تێبینی', value: 'Note', type: 'text' as const }
]

const REAL_ESTATE_BUY_FIELD_TYPES = Object.fromEntries(
    REAL_ESTATE_BUY_FIELDS.map((field) => [field.key, field.type])
)

function createRealEstateFieldsForTransactionType(transactionType: RealEstateTransactionType) {
    const labels = getRealEstateNativeTemplateFieldLabels(transactionType)
    const placeholders = getRealEstateNativeFieldPlaceholders(transactionType)

    return REAL_ESTATE_BUY_FIELDS.map((field) => ({
        ...field,
        label: labels[field.key as keyof typeof labels] || field.label,
        placeholder: placeholders[field.key as keyof typeof placeholders] || field.placeholder
    }))
}

function createRealEstateDataKeysForTransactionType(transactionType: RealEstateTransactionType) {
    const labels = getRealEstateTemplateKeyLabels(transactionType)

    return REAL_ESTATE_BUY_TRANSACTION_KEYS.map((key) => ({
        ...key,
        label: labels[key.key as keyof typeof labels] || key.label,
        group: key.group === 'Buyer'
            ? labels.buyerGroup
            : key.group === 'Seller'
                ? labels.sellerGroup
                : key.group
    }))
}

function buildQrValue(workspaceId?: string, effectiveId?: string, features?: WorkspaceFeatures) {
    if (!features?.print_qr || !workspaceId || !effectiveId || isLocalWorkspaceMode(workspaceId)) {
        return null
    }

    return `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf`
}

function createRealEstateContractPreview(
    options: CustomTemplatePreviewOptions,
    moduleTypeKey = 'realEstate.Sell'
): TemplatePreview {
    const transactionType = getRealEstateTransactionTypeFromModuleTypeKey(moduleTypeKey)
    const fields = createRealEstateFieldsForTransactionType(transactionType)
    const dataKeys = createRealEstateDataKeysForTransactionType(transactionType)
    const fieldPlaceholders = getRealEstateNativeFieldPlaceholders(transactionType)

    return {
        fields,
        dataKeys,
        fixedPrintLang: 'ku',
        createElement: (data, effectiveId, _printLangOverride, renderOptions) => (
            <RealEstateBuyPrintTemplate
                values={data}
                workspaceName={options.workspaceName}
                logoUrl={options.features?.logo_url}
                qrValue={buildQrValue(options.workspaceId, effectiveId, options.features)}
                workspaceFooterContacts={options.workspaceFooterContacts}
                editableFields={renderOptions?.editableFields}
                fieldTypes={REAL_ESTATE_BUY_FIELD_TYPES}
                fieldPlaceholders={fieldPlaceholders}
                transactionKeys={renderOptions?.dataKeys || dataKeys}
                tokenFieldTemplates={renderOptions?.tokenFieldTemplates}
                transactionType={transactionType}
                printLang={options.features?.print_lang}
                onFieldChange={renderOptions?.onFieldChange}
            />
        ),
        buildPdf: (element) => generateTemplatePdf({
            element,
            printLang: 'ku',
            printQuality: options.features?.print_quality
        })
    }
}

export function createCustomTemplatePreview(
    target: CustomTemplateTarget,
    options: CustomTemplatePreviewOptions = {}
): TemplatePreview {
    if (REAL_ESTATE_CONTRACT_MODULE_TYPE_KEYS.has(target.moduleTypeKey)) {
        return createRealEstateContractPreview(options, target.moduleTypeKey)
    }

    return {
        fields: [],
        createElement: () => (
            <div
                className="mx-auto border border-slate-200 bg-white px-10 py-9 text-slate-950 shadow-sm"
                style={{ width: '210mm', minHeight: '297mm' }}
            >
                <div className="flex items-start justify-between border-b border-slate-200 pb-6">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            {target.moduleLabel}
                        </div>
                        <h2 className="mt-2 text-2xl font-semibold">{target.typeLabel} Print Template</h2>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500">
                        {target.moduleTypeKey}
                    </div>
                </div>

                <div className="mt-16 rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
                    <p className="text-sm font-medium text-slate-800">Native template is not configured yet.</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                        Custom text, images, and annotations can be positioned here and saved as the workspace custom layout.
                    </p>
                </div>
            </div>
        ),
        buildPdf: (element, printLangOverride) => generateTemplatePdf({ element, printLang: printLangOverride })
    }
}

function nonBlankFields(fields: Record<string, string>) {
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value.trim().length > 0)
    )
}

function CustomTemplateLayoutOverlay({ layout }: { layout: CustomTemplateLayout }) {
    return (
        <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 210 297">
                {layout.annotations.map((annotation, index) => (
                    <path
                        key={`annotation-${index}`}
                        d={`M ${annotation.points.map((point) => `${point.x},${point.y}`).join(' L ')}`}
                        stroke={annotation.color}
                        strokeWidth={annotation.brushSize}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={annotation.type === 'brush' ? 0.5 : 1}
                    />
                ))}
            </svg>

            {layout.images.map((image, index) => (
                <img
                    key={`image-${index}`}
                    src={platformService.convertFileSrc(image.path)}
                    alt=""
                    className="absolute block select-none"
                    style={{
                        left: `${(image.x / 210) * 100}%`,
                        top: `${(image.y / 297) * 100}%`,
                        width: `${(image.width / 210) * 100}%`,
                        transform: `rotate(${image.rotation || 0}deg)`,
                        transformOrigin: 'top left',
                        zIndex: 60 + index
                    }}
                />
            ))}

            {layout.texts.map((text, index) => (
                <div
                    key={`text-${text.id || index}`}
                    className="absolute whitespace-pre-wrap break-words font-bold leading-snug"
                    style={{
                        left: `${(text.x / 210) * 100}%`,
                        top: `${(text.y / 297) * 100}%`,
                        width: `${(text.width / 210) * 100}%`,
                        transform: `rotate(${text.rotation || 0}deg)`,
                        transformOrigin: 'top left',
                        zIndex: 100 + index,
                        fontSize: `${text.fontSize || 16}px`,
                        color: text.color || '#000000'
                    }}
                >
                    {text.text}
                </div>
            ))}
        </div>
    )
}

export function renderCustomTemplateLayoutElement({
    target,
    layout,
    values,
    options,
    effectiveId,
    fieldMode = 'nonBlankLayoutOverrides'
}: {
    target: CustomTemplateTarget
    layout: CustomTemplateLayout
    values: Record<string, string>
    options?: CustomTemplatePreviewOptions
    effectiveId?: string
    fieldMode?: 'nonBlankLayoutOverrides' | 'layoutOverrides'
}) {
    const preview = createCustomTemplatePreview(target, options)
    const fieldValues = {
        ...values,
        ...(fieldMode === 'layoutOverrides' ? layout.fields || {} : nonBlankFields(layout.fields || {}))
    }

    return (
        <div
            className="relative mx-auto overflow-hidden bg-white text-black"
            style={{
                width: `${layout.page.widthMm || 210}mm`,
                height: `${layout.page.heightMm || 297}mm`
            }}
        >
            {preview.createElement(fieldValues, effectiveId, preview.fixedPrintLang, {
                tokenFieldTemplates: layout.fieldTokenTemplates
            })}
            <CustomTemplateLayoutOverlay layout={layout} />
        </div>
    )
}

export async function buildCustomTemplateLayoutPdf({
    target,
    layout,
    values,
    options,
    effectiveId,
    fieldMode = 'nonBlankLayoutOverrides'
}: {
    target: CustomTemplateTarget
    layout: CustomTemplateLayout
    values: Record<string, string>
    options?: CustomTemplatePreviewOptions
    effectiveId?: string
    fieldMode?: 'nonBlankLayoutOverrides' | 'layoutOverrides'
}) {
    const preview = createCustomTemplatePreview(target, options)
    const printableLayout = fieldMode === 'layoutOverrides'
        ? layout
        : {
            ...layout,
            fields: nonBlankFields(layout.fields || {})
        }
    const element = renderCustomTemplateLayoutElement({
        target,
        layout: printableLayout,
        values,
        options,
        effectiveId,
        fieldMode
    })

    return generateTemplatePdf({
        element,
        format: 'a4',
        printLang: preview.fixedPrintLang,
        printQuality: options?.features?.print_quality
    })
}
