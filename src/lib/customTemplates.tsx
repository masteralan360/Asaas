import { generateTemplatePdf } from '@/services/pdfGenerator'
import type {
    CustomTemplateLayout,
    CustomTemplatePrintLanguage,
    TemplatePreview,
    TemplatePreviewDataKey
} from '@/lib/pdfPreviewStore'
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
import type {
    OrderInstallment,
    PurchaseOrder,
    RealEstateTransactionType,
    SalesOrder
} from '@/local-db'
import type { WorkspaceFeatures } from '@/workspace'
import type { UniversalInvoice } from '@/types'
import {
    SaleReceiptBase,
    SALE_RECEIPT_TEMPLATE_FIELD_KEYS
} from '@/ui/components/SaleReceipt'
import {
    PartnerDetailsPrintTemplate,
    type PartnerDetailsPrintData
} from '@/ui/components/crm/PartnerDetailsPrintTemplate'
import {
    ORDER_DETAILS_MOVABLE_COMPONENT_KEYS,
    OrderDetailsPrintTemplate
} from '@/ui/components/orders/OrderPrintTemplates'

export const SALES_HISTORY_RECEIPT_TEMPLATE_KEY = 'salesHistory.Receipt'
export const PARTNER_DETAILS_TEMPLATE_KEY = 'businessPartners.Details'
export const ORDER_DETAILS_TEMPLATE_KEY = 'orders.Details'
export const PARTNER_DETAILS_TEMPLATE_FIELD_KEYS = {
    showWhoOwesWhom: 'showWhoOwesWhom',
    showOrders: 'showOrders'
} as const
export const ORDER_DETAILS_TEMPLATE_FIELD_KEYS = {
    hideUnit: 'hideUnit',
    hideDiscount: 'hideDiscount'
} as const

export type CustomTemplateTarget = {
    moduleTypeKey: string
    workspaceModuleKey: 'real_estate' | 'sales_history' | 'crm'
    moduleLabel: string
    typeLabel: string
    description: string
    nativeTemplateKey: string
    nativeTemplateAvailable: boolean
    printFormat: 'a4' | 'receipt'
    page: {
        widthMm: number
        heightMm: number
    }
}

const REAL_ESTATE_CONTRACT_TARGETS: Array<Pick<CustomTemplateTarget, 'moduleTypeKey' | 'typeLabel' | 'description' | 'nativeTemplateKey' | 'nativeTemplateAvailable' | 'printFormat' | 'page'>> = [
    {
        moduleTypeKey: 'realEstate.Sell',
        typeLabel: 'Sell',
        description: 'Real estate sell transaction print layout.',
        nativeTemplateKey: 'realEstate.Sell',
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
    {
        moduleTypeKey: 'realEstate.Buy',
        typeLabel: 'Buy',
        description: 'Real estate buy transaction print layout.',
        nativeTemplateKey: 'realEstate.Buy',
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
    {
        moduleTypeKey: 'realEstate.Rent',
        typeLabel: 'Rent',
        description: 'Real estate rent transaction print layout.',
        nativeTemplateKey: 'realEstate.Rent',
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
    {
        moduleTypeKey: 'realEstate.Lease',
        typeLabel: 'Lease',
        description: 'Real estate lease transaction print layout.',
        nativeTemplateKey: 'realEstate.Lease',
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
    {
        moduleTypeKey: 'realEstate.Exchange',
        typeLabel: 'Exchange',
        description: 'Real estate exchange transaction print layout.',
        nativeTemplateKey: 'realEstate.Exchange',
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    }
]

const REAL_ESTATE_CONTRACT_MODULE_TYPE_KEYS = new Set(
    REAL_ESTATE_CONTRACT_TARGETS.map((target) => target.moduleTypeKey)
)

export const CUSTOM_TEMPLATE_TARGETS: CustomTemplateTarget[] = [
    {
        moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
        workspaceModuleKey: 'sales_history',
        moduleLabel: 'Sales History',
        typeLabel: 'Receipt Print',
        description: 'Sales History thermal receipt print layout.',
        nativeTemplateKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
        nativeTemplateAvailable: true,
        printFormat: 'receipt',
        page: { widthMm: 80, heightMm: 200 }
    },
    {
        moduleTypeKey: PARTNER_DETAILS_TEMPLATE_KEY,
        workspaceModuleKey: 'crm',
        moduleLabel: 'Business Partners',
        typeLabel: 'Partner Details',
        description: 'Business partner details A4 print layout.',
        nativeTemplateKey: PARTNER_DETAILS_TEMPLATE_KEY,
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
    {
        moduleTypeKey: ORDER_DETAILS_TEMPLATE_KEY,
        workspaceModuleKey: 'crm',
        moduleLabel: 'Orders',
        typeLabel: 'Order Print',
        description: 'Sales and purchase order details A4 print layout.',
        nativeTemplateKey: ORDER_DETAILS_TEMPLATE_KEY,
        nativeTemplateAvailable: true,
        printFormat: 'a4',
        page: { widthMm: 210, heightMm: 297 }
    },
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

export function resolveCustomTemplatePrintLanguage(
    configuredPrintLanguage?: string | null,
    fallbackLanguage = 'en'
): CustomTemplatePrintLanguage {
    const candidate = configuredPrintLanguage && configuredPrintLanguage !== 'auto'
        ? configuredPrintLanguage
        : fallbackLanguage
    const baseLanguage = candidate.toLowerCase().split('-')[0]

    if (baseLanguage === 'ar' || baseLanguage === 'ku') {
        return baseLanguage
    }

    return 'en'
}

export function stampCustomTemplatePrintLanguage(
    layout: CustomTemplateLayout,
    configuredPrintLanguage?: string | null,
    fallbackLanguage = 'en'
): CustomTemplateLayout {
    return {
        ...layout,
        printLanguage: resolveCustomTemplatePrintLanguage(configuredPrintLanguage, fallbackLanguage)
    }
}

export type StoredCustomTemplateRow = {
    id: string
    module_type_key: string
    label?: string | null
    layout_json: unknown
    active?: boolean
    primary?: boolean
    version?: number
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
        printLanguage: layout.printLanguage === 'ar' || layout.printLanguage === 'ku' || layout.printLanguage === 'en'
            ? layout.printLanguage
            : undefined,
        page: {
            widthMm: layout.page?.widthMm || 210,
            heightMm: layout.page?.heightMm || 297
        },
        fields: layout.fields || {},
        componentPositions: layout.componentPositions || {},
        annotations: layout.annotations || [],
        texts: layout.texts || [],
        images: layout.images || [],
        updatedAt: typeof layout.updatedAt === 'string' ? layout.updatedAt : row.updated_at || new Date().toISOString()
    }
}

export function getStoredCustomTemplatePrintLanguage(
    row?: StoredCustomTemplateRow | null
): CustomTemplatePrintLanguage | null {
    return readCustomTemplateLayout(row)?.printLanguage || null
}

export function isCustomTemplatePrintLanguageCompatible(
    row: StoredCustomTemplateRow | null | undefined,
    currentPrintLanguage: string
) {
    const storedPrintLanguage = getStoredCustomTemplatePrintLanguage(row)
    return storedPrintLanguage !== null
        && storedPrintLanguage === resolveCustomTemplatePrintLanguage(currentPrintLanguage)
}

export function getCustomTemplatePrintLanguageWarning(
    row: StoredCustomTemplateRow,
    currentPrintLanguage: string,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    const storedPrintLanguage = getStoredCustomTemplatePrintLanguage(row)
    if (!storedPrintLanguage) {
        return t('customTemplates.languageMissingWarning', {
            defaultValue: 'No print language is saved in this template. Open and save it again before printing.'
        })
    }

    const normalizedCurrentPrintLanguage = resolveCustomTemplatePrintLanguage(currentPrintLanguage)
    if (storedPrintLanguage === normalizedCurrentPrintLanguage) {
        return undefined
    }

    return t('customTemplates.languageMismatchWarning', {
        defaultValue: 'Saved for {{templateLanguage}}, but workspace printing is {{workspaceLanguage}}. Change the print language or save this template again.',
        templateLanguage: storedPrintLanguage.toUpperCase(),
        workspaceLanguage: normalizedCurrentPrintLanguage.toUpperCase()
    })
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
    receiptData?: UniversalInvoice
    partnerDetailsData?: PartnerDetailsPrintData
    order?: SalesOrder | PurchaseOrder
    orderKind?: 'sales' | 'purchase'
    orderInstallments?: OrderInstallment[]
    printLang?: string
}

const SAMPLE_RECEIPT_DATA: UniversalInvoice = {
    id: 'custom-template-receipt',
    sequenceId: 1,
    invoiceid: '#00636',
    created_at: new Date().toISOString(),
    cashier_name: 'Demo',
    items: [
        {
            product_id: 'sample-product',
            product_name: 'Sample Product',
            product_sku: '42432423423',
            quantity: 1,
            unit_price: 100000,
            total_price: 100000,
            original_unit_price: 64,
            original_currency: 'usd',
            settlement_currency: 'iqd'
        }
    ],
    total_amount: 100000,
    settlement_currency: 'iqd',
    payment_method: 'cash',
    exchange_rates: [
        {
            pair: 'USD/IQD',
            rate: 155700,
            source: 'XEIQD',
            timestamp: new Date().toISOString()
        }
    ],
    status: 'paid'
}

const SAMPLE_PARTNER_DETAILS_DATA: PartnerDetailsPrintData = {
    partner: {
        name: 'Sample Business Partner',
        role: 'both',
        contactName: 'Primary Contact',
        email: 'partner@example.com',
        phone: '+964 750 000 0000',
        address: 'Business District',
        city: 'Erbil',
        country: 'Iraq',
        defaultCurrency: 'usd',
        createdAt: new Date().toISOString(),
        notes: 'Partner notes appear here.'
    },
    period: {
        type: 'allTime'
    },
    generatedAt: new Date().toISOString(),
    loanSummary: {
        remainingReceivable: 2500,
        remainingPayable: 1200,
        paymentsReceived: 8000,
        paymentsMade: 3200
    },
    metrics: {
        moneyIn: 42000,
        moneyOut: 18500
    },
    relationshipSummary: {
        receivable: 2500,
        payable: 1200
    },
    providedByYou: [
        {
            id: 'sample-sales-order',
            source: 'sales_order',
            reference: 'SO-00042',
            displayDate: new Date().toISOString(),
            status: 'completed',
            statusLabel: 'Completed',
            summary: 'Sample product order',
            originalAmount: 12000,
            paidAmount: 12000,
            remainingAmount: 0,
            currency: 'usd'
        }
    ],
    providedByPartner: [
        {
            id: 'sample-loan',
            source: 'loan',
            reference: 'LN-00007',
            displayDate: new Date().toISOString(),
            status: 'active',
            statusLabel: 'Active',
            summary: 'Installment loan',
            originalAmount: 5000,
            paidAmount: 2500,
            remainingAmount: 2500,
            currency: 'usd'
        }
    ],
    salesOrders: [
        {
            id: 'sample-sales-order',
            source: 'sales_order',
            reference: 'SO-00042',
            displayDate: new Date().toISOString(),
            status: 'completed',
            statusLabel: 'Completed',
            summary: 'Sample product order',
            originalAmount: 12000,
            paidAmount: 12000,
            remainingAmount: 0,
            currency: 'usd'
        }
    ],
    purchaseOrders: [
        {
            id: 'sample-purchase-order',
            source: 'purchase_order',
            reference: 'PO-00019',
            displayDate: new Date().toISOString(),
            status: 'received',
            statusLabel: 'Received',
            summary: 'Sample supply order',
            originalAmount: 7200,
            paidAmount: 3000,
            remainingAmount: 4200,
            currency: 'usd'
        }
    ],
    topProducts: [
        {
            id: 'sample-product',
            name: 'Sample Product',
            quantity: 48,
            amount: 24000
        }
    ]
}

const SAMPLE_ORDER_DATA: SalesOrder = {
    id: 'sample-sales-order',
    workspaceId: 'sample-workspace',
    orderNumber: 'SO-00042',
    customerId: 'sample-customer',
    customerName: 'Sample Customer',
    items: [
        {
            id: 'sample-order-item',
            productId: 'sample-product',
            productName: 'Sample Product',
            productSku: 'SKU-0001',
            quantity: 2,
            lineTotal: 200,
            originalCurrency: 'usd',
            originalUnitPrice: 100,
            convertedUnitPrice: 100,
            settlementCurrency: 'usd',
            costPrice: 70,
            convertedCostPrice: 70
        }
    ],
    subtotal: 200,
    discount: 10,
    tax: 9.5,
    total: 199.5,
    currency: 'usd',
    exchangeRate: null,
    exchangeRateSource: null,
    exchangeRateTimestamp: null,
    status: 'pending',
    expectedDeliveryDate: new Date().toISOString(),
    isPaid: false,
    paymentStatus: 'partial',
    paidAmount: 50,
    balanceAmount: 149.5,
    paymentMethod: 'cash',
    isInstallmentBased: false,
    installmentCount: 0,
    shippingAddress: 'Business District, Erbil',
    notes: 'Order notes appear here.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: null,
    version: 1,
    isDeleted: false
}

const PARTNER_DETAILS_FIELDS = [
    {
        key: PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showWhoOwesWhom,
        label: 'Show the "Who owes whom" section',
        value: 'true',
        type: 'boolean' as const
    },
    {
        key: PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showOrders,
        label: 'Show the orders',
        value: 'false',
        type: 'boolean' as const
    }
]

const ORDER_DETAILS_FIELDS = [
    {
        key: ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideUnit,
        label: 'Hide item units',
        value: 'false',
        type: 'boolean' as const
    },
    {
        key: ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideDiscount,
        label: 'Hide discounts',
        value: 'false',
        type: 'boolean' as const
    }
]

const SALES_HISTORY_RECEIPT_FIELDS = [
    {
        key: SALE_RECEIPT_TEMPLATE_FIELD_KEYS.showExchangeRateSnapshots,
        label: 'Exchange rate source snapshot',
        value: 'true',
        type: 'boolean' as const
    },
    {
        key: SALE_RECEIPT_TEMPLATE_FIELD_KEYS.showOriginalCurrencyPrice,
        label: 'Original currency price',
        value: 'true',
        type: 'boolean' as const
    },
    {
        key: SALE_RECEIPT_TEMPLATE_FIELD_KEYS.thankYou,
        label: 'Thank-you text',
        value: '',
        type: 'text' as const,
        placeholder: 'Thank you for shopping with us!'
    },
    {
        key: SALE_RECEIPT_TEMPLATE_FIELD_KEYS.keepRecord,
        label: 'Keep-record text',
        value: '',
        type: 'text' as const,
        placeholder: 'Please keep this receipt for your records.'
    }
]

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
        page: { widthMm: 210, heightMm: 297 },
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
        })
    }
}

function createSalesHistoryReceiptPreview(options: CustomTemplatePreviewOptions): TemplatePreview {
    const receiptData = options.receiptData || SAMPLE_RECEIPT_DATA

    return {
        fields: SALES_HISTORY_RECEIPT_FIELDS,
        page: { widthMm: 80, heightMm: 200 },
        createElement: (data, _effectiveId, _printLangOverride, renderOptions) => (
            <div className="mx-auto w-[80mm] bg-white text-black">
                <SaleReceiptBase
                    data={receiptData}
                    features={options.features || {}}
                    workspaceName={options.workspaceName || 'Atlas'}
                    workspaceId={options.workspaceId}
                    templateFields={data}
                    editableFields={renderOptions?.editableFields}
                    onTemplateFieldChange={renderOptions?.onFieldChange}
                />
            </div>
        ),
        buildPdf: (element, printLangOverride) => generateTemplatePdf({
            element,
            format: 'receipt',
            printLang: printLangOverride
        })
    }
}

function createPartnerDetailsPreview(options: CustomTemplatePreviewOptions): TemplatePreview {
    const partnerDetailsData = options.partnerDetailsData || SAMPLE_PARTNER_DETAILS_DATA
    const configuredPrintLang = options.features?.print_lang
    const printLang = options.printLang
        || (configuredPrintLang && configuredPrintLang !== 'auto' ? configuredPrintLang : 'en')
    const fixedPrintLang: TemplatePreview['fixedPrintLang'] = printLang.startsWith('ar')
        ? 'ar'
        : printLang.startsWith('ku')
            ? 'ku'
            : 'en'

    return {
        fields: PARTNER_DETAILS_FIELDS,
        page: { widthMm: 210, heightMm: 297 },
        fixedPrintLang,
        createElement: (data, _effectiveId, printLangOverride) => (
            <PartnerDetailsPrintTemplate
                workspaceName={options.workspaceName}
                printLang={printLangOverride || fixedPrintLang}
                data={partnerDetailsData}
                iqdPreference={options.features?.iqd_display_preference}
                logoUrl={options.features?.logo_url}
                showWhoOwesWhom={data[PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showWhoOwesWhom] !== 'false'}
                showOrders={data[PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showOrders] === 'true'}
            />
        ),
        buildPdf: (element, printLangOverride) => generateTemplatePdf({
            element,
            format: 'a4',
            printLang: printLangOverride || fixedPrintLang
        })
    }
}

function createOrderDetailsPreview(options: CustomTemplatePreviewOptions): TemplatePreview {
    const order = options.order || SAMPLE_ORDER_DATA
    const kind = options.orderKind || 'sales'
    const configuredPrintLang = options.features?.print_lang
    const printLang = options.printLang
        || (configuredPrintLang && configuredPrintLang !== 'auto' ? configuredPrintLang : 'en')
    const fixedPrintLang: TemplatePreview['fixedPrintLang'] = printLang.startsWith('ar')
        ? 'ar'
        : printLang.startsWith('ku')
            ? 'ku'
            : 'en'

    return {
        fields: ORDER_DETAILS_FIELDS,
        movableComponents: [
            {
                key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.customer,
                label: kind === 'sales' ? 'Customer' : 'Supplier'
            },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.commercials, label: 'Commercials' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.created, label: 'Created' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.expectedDelivery, label: 'Expected Delivery' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.orderItems, label: 'Order Items and Table' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.totals, label: 'Subtotal, Discount, Tax and Total' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.logo, label: 'Logo' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.qrCode, label: 'QR Code' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.workspaceName, label: 'Workspace Name' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.title, label: 'Title' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.subtitle, label: 'Subtitle' },
            { key: ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.contacts, label: 'Contacts' }
        ],
        page: { widthMm: 210, heightMm: 297 },
        fixedPrintLang,
        createElement: (data, effectiveId, printLangOverride, renderOptions) => (
            <OrderDetailsPrintTemplate
                workspaceName={options.workspaceName}
                printLang={printLangOverride || fixedPrintLang}
                order={order}
                installments={options.orderInstallments || []}
                kind={kind}
                iqdPreference={options.features?.iqd_display_preference}
                logoUrl={options.features?.logo_url}
                qrValue={buildQrValue(options.workspaceId, effectiveId, options.features)}
                hideUnit={data[ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideUnit] === 'true'}
                hideDiscount={data[ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideDiscount] === 'true'}
                componentPositions={renderOptions?.componentPositions}
                editableComponents={renderOptions?.editableComponents}
                onComponentPositionChange={renderOptions?.onComponentPositionChange}
                workspaceFooterContacts={renderOptions?.workspaceFooterContacts || options.workspaceFooterContacts}
            />
        ),
        buildPdf: (element, printLangOverride) => generateTemplatePdf({
            element,
            format: 'a4',
            printLang: printLangOverride || fixedPrintLang
        })
    }
}

export function createCustomTemplatePreview(
    target: CustomTemplateTarget,
    options: CustomTemplatePreviewOptions = {}
): TemplatePreview {
    if (target.moduleTypeKey === SALES_HISTORY_RECEIPT_TEMPLATE_KEY) {
        return createSalesHistoryReceiptPreview(options)
    }

    if (target.moduleTypeKey === PARTNER_DETAILS_TEMPLATE_KEY) {
        return createPartnerDetailsPreview(options)
    }

    if (target.moduleTypeKey === ORDER_DETAILS_TEMPLATE_KEY) {
        return createOrderDetailsPreview(options)
    }

    if (REAL_ESTATE_CONTRACT_MODULE_TYPE_KEYS.has(target.moduleTypeKey)) {
        return createRealEstateContractPreview(options, target.moduleTypeKey)
    }

    return {
        fields: [],
        page: target.page,
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
    const pageWidth = layout.page.widthMm || 210
    const pageHeight = layout.page.heightMm || 297

    return (
        <div
            className="pointer-events-none absolute start-0 top-0 z-50 overflow-hidden"
            style={{ width: '100%', height: `${pageHeight}mm` }}
        >
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${pageWidth} ${pageHeight}`}>
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
                        left: `${(image.x / pageWidth) * 100}%`,
                        top: `${(image.y / pageHeight) * 100}%`,
                        width: `${(image.width / pageWidth) * 100}%`,
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
                        left: `${(text.x / pageWidth) * 100}%`,
                        top: `${(text.y / pageHeight) * 100}%`,
                        width: `${(text.width / pageWidth) * 100}%`,
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

    const isReceipt = target.printFormat === 'receipt'
    const supportsMultiplePages = target.moduleTypeKey === PARTNER_DETAILS_TEMPLATE_KEY
        || target.moduleTypeKey === ORDER_DETAILS_TEMPLATE_KEY

    return (
        <div
            className={`relative mx-auto bg-white text-black ${supportsMultiplePages ? 'overflow-visible' : 'overflow-hidden'}`}
            style={{
                width: `${layout.page.widthMm || 210}mm`,
                ...(isReceipt
                    ? { minHeight: `${layout.page.heightMm || 297}mm` }
                    : supportsMultiplePages
                    ? { minHeight: `${layout.page.heightMm || 297}mm` }
                    : { height: `${layout.page.heightMm || 297}mm` })
            }}
        >
            {preview.createElement(fieldValues, effectiveId, preview.fixedPrintLang, {
                tokenFieldTemplates: layout.fieldTokenTemplates,
                componentPositions: layout.componentPositions
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
        format: target.printFormat,
        printLang: preview.fixedPrintLang,
    })
}
