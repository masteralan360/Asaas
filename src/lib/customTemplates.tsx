import { generateTemplatePdf } from '@/services/pdfGenerator'
import type { TemplatePreview, TemplatePreviewDataKey } from '@/lib/pdfPreviewStore'
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
    { key: 'transactionNo', label: 'Transaction number', group: 'Deal' },
    { key: 'transactionType', label: 'Transaction type', group: 'Deal' },
    { key: 'status', label: 'Transaction status', group: 'Deal' },
    { key: 'location', label: 'Property location', group: 'Property' },
    { key: 'propertyType', label: 'Property type', group: 'Property' },
    { key: 'landAreaM2', label: 'Property area (m²)', group: 'Property' },
    { key: 'currency', label: 'Currency', group: 'Amounts' },
    { key: 'totalAmount', label: 'Total amount', group: 'Amounts' },
    { key: 'paidAmount', label: 'Paid amount', group: 'Amounts' },
    { key: 'balanceAmount', label: 'Balance amount', group: 'Amounts' },
    { key: 'profitAmount', label: 'Profit amount', group: 'Amounts' },
    { key: 'buyerName', label: 'Buyer name', group: 'Buyer' },
    { key: 'buyerPhone', label: 'Buyer phone number', group: 'Buyer' },
    { key: 'buyerBusinessPartnerId', label: 'Buyer business partner ID', group: 'Buyer' },
    { key: 'buyerWitnessName', label: 'Buyer witness name', group: 'Buyer' },
    { key: 'buyerWitnessAddress', label: 'Buyer witness address', group: 'Buyer' },
    { key: 'buyerWitnessPhone', label: 'Buyer witness phone number', group: 'Buyer' },
    { key: 'sellerName', label: 'Seller name', group: 'Seller' },
    { key: 'sellerPhone', label: 'Seller phone number', group: 'Seller' },
    { key: 'sellerBusinessPartnerId', label: 'Seller business partner ID', group: 'Seller' },
    { key: 'sellerWitnessName', label: 'Seller witness name', group: 'Seller' },
    { key: 'sellerWitnessAddress', label: 'Seller witness address', group: 'Seller' },
    { key: 'sellerWitnessPhone', label: 'Seller witness phone number', group: 'Seller' },
    { key: 'isInstallmentBased', label: 'Installment-based deal', group: 'Installments' },
    { key: 'installmentCount', label: 'Installment count', group: 'Installments' },
    { key: 'installmentFrequency', label: 'Installment frequency', group: 'Installments' },
    { key: 'firstDueDate', label: 'First due date', group: 'Installments' },
    { key: 'nextDueDate', label: 'Next due date', group: 'Installments' },
    { key: 'notes', label: 'Notes', group: 'Deal' },
    { key: 'createdAt', label: 'Created date', group: 'System' },
    { key: 'updatedAt', label: 'Updated date', group: 'System' }
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

function buildQrValue(workspaceId?: string, effectiveId?: string, features?: WorkspaceFeatures) {
    if (!features?.print_qr || !workspaceId || !effectiveId || isLocalWorkspaceMode(workspaceId)) {
        return null
    }

    return `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf`
}

function createRealEstateBuyPreview(options: CustomTemplatePreviewOptions): TemplatePreview {
    return {
        fields: REAL_ESTATE_BUY_FIELDS,
        dataKeys: REAL_ESTATE_BUY_TRANSACTION_KEYS,
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
                fieldPlaceholders={REAL_ESTATE_BUY_FIELD_PLACEHOLDERS}
                transactionKeys={renderOptions?.dataKeys || REAL_ESTATE_BUY_TRANSACTION_KEYS}
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
