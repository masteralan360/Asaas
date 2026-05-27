import { generateTemplatePdf } from '@/services/pdfGenerator'
import type { TemplatePreview } from '@/lib/pdfPreviewStore'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import {
    RealEstateBuyPrintTemplate,
    type WorkspaceFooterContacts
} from '@/ui/components/real-estate/RealEstateBuyPrintTemplate'
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

export const CUSTOM_TEMPLATE_TARGETS: CustomTemplateTarget[] = [
    {
        moduleTypeKey: 'realEstate.Buy',
        workspaceModuleKey: 'real_estate',
        moduleLabel: 'Real Estate',
        typeLabel: 'Buy',
        description: 'Real estate buy transaction print layout.',
        nativeTemplateKey: 'realEstate.Buy',
        nativeTemplateAvailable: true
    },
    {
        moduleTypeKey: 'realEstate.Rent',
        workspaceModuleKey: 'real_estate',
        moduleLabel: 'Real Estate',
        typeLabel: 'Rent',
        description: 'Real estate rent transaction print layout.',
        nativeTemplateKey: 'realEstate.Rent',
        nativeTemplateAvailable: false
    }
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

type CustomTemplatePreviewOptions = {
    workspaceId?: string
    workspaceName?: string | null
    features?: WorkspaceFeatures
    workspaceFooterContacts?: WorkspaceFooterContacts
}

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
    { key: 'sellerWitnessName', label: 'شاهیدی فرۆشیار', value: 'چیوار ئەسعد احمد', type: 'text' as const },
    { key: 'sellerWitnessRole', label: 'کاری شاهیدی فرۆشیار', value: 'قەفازی', type: 'text' as const },
    { key: 'sellerWitnessPhone', label: 'ژمارەی شاهیدی فرۆشیار', value: '07501114345', type: 'text' as const },
    { key: 'sellerSignatureName', label: 'واژۆی فرۆشیار', value: '', type: 'text' as const },
    { key: 'sellerSignatureRole', label: 'کاری فرۆشیار', value: 'ڕایە', type: 'text' as const },
    { key: 'sellerSignaturePhone', label: 'ژمارەی فرۆشیار', value: '07571112545', type: 'text' as const },
    { key: 'buyerSignatureName', label: 'واژۆی کڕیار', value: '', type: 'text' as const },
    { key: 'buyerSignatureRole', label: 'کاری کڕیار', value: 'ڕایە', type: 'text' as const },
    { key: 'buyerSignaturePhone', label: 'ژمارەی کڕیار', value: '07501199745', type: 'text' as const },
    { key: 'buyerWitnessName', label: 'شاهیدی کڕیار', value: 'ئه‌حمه‌د حه‌سه‌ن عه‌لی', type: 'text' as const },
    { key: 'buyerWitnessRole', label: 'کاری شاهیدی کڕیار', value: 'قەفازی', type: 'text' as const },
    { key: 'buyerWitnessPhone', label: 'ژمارەی شاهیدی کڕیار', value: '07501112345', type: 'text' as const },
    { key: 'note', label: 'تێبینی', value: 'Note', type: 'text' as const }
]

const REAL_ESTATE_BUY_FIELD_TYPES = Object.fromEntries(
    REAL_ESTATE_BUY_FIELDS.map((field) => [field.key, field.type])
)

function buildQrValue(workspaceId?: string, effectiveId?: string, features?: WorkspaceFeatures) {
    if (!features?.print_qr || !workspaceId || !effectiveId || isLocalWorkspaceMode(workspaceId)) {
        return null
    }

    return `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf`
}

function createRealEstateBuyPreview(options: CustomTemplatePreviewOptions): TemplatePreview {
    return {
        fields: REAL_ESTATE_BUY_FIELDS,
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
    if (target.moduleTypeKey === 'realEstate.Buy') {
        return createRealEstateBuyPreview(options)
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
