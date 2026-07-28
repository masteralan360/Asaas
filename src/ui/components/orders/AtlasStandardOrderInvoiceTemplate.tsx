import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
    getOrderBalanceAmount,
    getOrderPaidAmount,
    type BusinessPartner,
    type IQDDisplayPreference,
    type OrderInstallment,
    type PurchaseOrder,
    type SalesOrder
} from '@/local-db'
import { getOrderLineFreeBonusQuantity, getOrderLinePaidQuantity } from '@/lib/orderLineItems'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/components/dialog'
import type { CustomTemplateComponentPosition } from '@/lib/pdfPreviewStore'
import { MovableOrderPrintBlock } from '@/ui/components/MovableComponentPrint'

type OrderKind = 'sales' | 'purchase'

interface WorkspaceContactPair {
    primary?: string
    nonPrimary?: string
}

interface WorkspaceFooterContacts {
    address?: WorkspaceContactPair
    email?: WorkspaceContactPair
    phone?: WorkspaceContactPair
}

export interface AtlasStandardOrderInvoiceTemplateProps {
    workspaceName?: string | null
    printLang: string
    order: SalesOrder | PurchaseOrder
    installments?: OrderInstallment[]
    kind: OrderKind
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
    workspaceFooterContacts?: WorkspaceFooterContacts
    businessPartner?: BusinessPartner | null
    printedBy?: string | null
    componentPositions?: Record<string, CustomTemplateComponentPosition>
    editableComponents?: boolean
    onComponentPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
    hiddenFields?: Record<string, boolean>
    onHiddenFieldChange?: (key: string, hidden: boolean) => void
}

const INK = '#244f87'
// The compact grid keeps an 8 mm A4 safety buffer for the financial section and fixed footer.
const TABLE_DATA_AREA_MM = 145
const TABLE_ITEM_ROW_MM = 8

export const ATLAS_STANDARD_ORDER_MOVABLE_COMPONENT_KEYS = {
    logo: 'atlasStandardWorkspaceLogo',
    workspaceName: 'atlasStandardWorkspaceName'
} as const

export const ATLAS_STANDARD_ORDER_HIDDEN_FIELD_KEYS = {
    invoiceDetails: {
        partner: 'atlasStandard.invoiceDetails.partner',
        invoice: 'atlasStandard.invoiceDetails.invoice',
        number: 'atlasStandard.invoiceDetails.number',
        salesPerson: 'atlasStandard.invoiceDetails.salesPerson',
        location: 'atlasStandard.invoiceDetails.location',
        documentNumber: 'atlasStandard.invoiceDetails.documentNumber',
        invoiceDate: 'atlasStandard.invoiceDetails.invoiceDate',
        time: 'atlasStandard.invoiceDetails.time',
        status: 'atlasStandard.invoiceDetails.status'
    },
    table: {
        number: 'atlasStandard.table.number',
        product: 'atlasStandard.table.product',
        expiry: 'atlasStandard.table.expiry',
        batchNumber: 'atlasStandard.table.batchNumber',
        quantity: 'atlasStandard.table.quantity',
        freeQuantity: 'atlasStandard.table.freeQuantity',
        price: 'atlasStandard.table.price',
        total: 'atlasStandard.table.total'
    },
    financialSummary: {
        paidAmount: 'atlasStandard.financialSummary.paidAmount',
        discount: 'atlasStandard.financialSummary.discount',
        amountInWords: 'atlasStandard.financialSummary.amountInWords',
        outstanding: 'atlasStandard.financialSummary.outstanding',
        paymentMethod: 'atlasStandard.financialSummary.paymentMethod',
        currentBalance: 'atlasStandard.financialSummary.currentBalance',
        printedBy: 'atlasStandard.financialSummary.printedBy',
        notes: 'atlasStandard.financialSummary.notes'
    }
} as const

type TableColumn = {
    key: string
    label: string
    width: string
}

type HideablePrintField = {
    key: string
    label: ReactNode
    value?: ReactNode
    render?: ReactNode
    className?: string
}

function isRTL(language: string) {
    const baseLanguage = (language || 'en').split('-')[0]
    return baseLanguage === 'ar' || baseLanguage === 'ku'
}

type AtlasStandardLocale = 'en' | 'ar' | 'ku'

function resolveAtlasStandardLocale(language: string): AtlasStandardLocale {
    const baseLanguage = (language || 'en').split('-')[0]
    return baseLanguage === 'ar' || baseLanguage === 'ku' ? baseLanguage : 'en'
}

const ATLAS_STANDARD_LABELS = {
    en: {
        customer: 'Customer', supplier: 'Supplier', invoice: 'Invoice', salesOrder: 'Sales Order', purchaseOrder: 'Purchase Order', number: 'No.', salesPerson: 'Cashier', partnerAddress: "Partner's Address", status: 'Status', documentNumber: 'Document No.', invoiceDate: 'Inv. date', time: 'Time',
        productName: 'Product Name', expiry: 'EXP', batchNumber: 'Batch No.', quantity: 'Qty', freeQuantity: 'Free Qty', price: 'Price', total: 'Total',
        paidAmount: 'Paid Amount', discount: 'Discount', amountInWords: 'Amount in words', paymentMethod: 'Payment Method', outstanding: 'Order Outstanding', currentBalance: "Partner's Current Balance", printedBy: 'Printed by', notes: 'Notes',
        invoiceDetails: 'Invoice details', orderItemsTable: 'Order items table', financialSummary: 'Financial summary', selectValues: 'Select the values to include in this print.', selectColumns: 'Select the table columns to include in this print.', noColumns: 'No item columns selected', logo: 'LOGO', workspaceLogo: 'Workspace logo', workspaceName: 'Workspace Name', email: 'Email', madeBy: 'Made By AtlasERP', page: 'Page', pageOf: 'from', printDate: 'Print date',
        statuses: { draft: 'Draft', pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled', ordered: 'Ordered', received: 'Received' },
        paymentMethods: { cash: 'Cash', fib: 'FIB', qicard: 'Qi Card', zaincash: 'Zain Cash', fastpay: 'FastPay', bank_transfer: 'Bank Transfer', loan: 'Loan', installments: 'Installments' }
    },
    ar: {
        customer: 'العميل', supplier: 'المورد', invoice: 'الفاتورة', salesOrder: 'طلب مبيعات', purchaseOrder: 'طلب شراء', number: 'الرقم', salesPerson: 'أمين الصندوق', partnerAddress: 'عنوان الشريك', status: 'الحالة', documentNumber: 'رقم المستند', invoiceDate: 'تاريخ الفاتورة', time: 'الوقت',
        productName: 'اسم المنتج', expiry: 'الصلاحية', batchNumber: 'رقم التشغيلة', quantity: 'الكمية', freeQuantity: 'كمية مجانية', price: 'السعر', total: 'الإجمالي',
        paidAmount: 'المبلغ المدفوع', discount: 'الخصم', amountInWords: 'المبلغ كتابة', paymentMethod: 'طريقة الدفع', outstanding: 'المبلغ المتبقي للطلب', currentBalance: 'الرصيد الحالي للشريك', printedBy: 'طبع بواسطة', notes: 'ملاحظات',
        invoiceDetails: 'تفاصيل الفاتورة', orderItemsTable: 'جدول أصناف الطلب', financialSummary: 'الملخص المالي', selectValues: 'اختر القيم التي تريد تضمينها في هذه الطباعة.', selectColumns: 'اختر أعمدة الجدول التي تريد تضمينها في هذه الطباعة.', noColumns: 'لم يتم اختيار أي أعمدة للأصناف', logo: 'الشعار', workspaceLogo: 'شعار مساحة العمل', workspaceName: 'اسم مساحة العمل', email: 'البريد الإلكتروني', madeBy: 'تم الإنشاء بواسطة AtlasERP', page: 'الصفحة', pageOf: 'من', printDate: 'تاريخ الطباعة',
        statuses: { draft: 'مسودة', pending: 'قيد الانتظار', completed: 'مكتمل', cancelled: 'ملغى', ordered: 'تم الطلب', received: 'تم الاستلام' },
        paymentMethods: { cash: 'نقدي', fib: 'FIB', qicard: 'كي كارد', zaincash: 'زين كاش', fastpay: 'فاست باي', bank_transfer: 'تحويل بنكي', loan: 'قرض', installments: 'أقساط' }
    },
    ku: {
        customer: 'کڕیار', supplier: 'دابینکەر', invoice: 'پسوڵە', salesOrder: 'داواکاری فرۆشتن', purchaseOrder: 'داواکاری کڕین', number: 'ژمارە', salesPerson: 'کاشێر', partnerAddress: 'ناونیشانی هاوبەش', status: 'دۆخ', documentNumber: 'ژمارەی بەڵگە', invoiceDate: 'بەرواری پسوڵە', time: 'کات',
        productName: 'ناوی کاڵا', expiry: 'بەسەرچوون', batchNumber: 'ژمارەی بچ', quantity: 'بڕ', freeQuantity: 'بڕی بەخۆڕایی', price: 'نرخ', total: 'کۆی گشتی',
        paidAmount: 'بڕی دراو', discount: 'داشکاندن', amountInWords: 'بڕ بە نووسین', paymentMethod: 'شێوازی پارەدان', outstanding: 'بڕی ماوەی داواکاری', currentBalance: 'باڵانسی ئێستای هاوبەش', printedBy: 'چاپکراوە لەلایەن', notes: 'تێبینی',
        invoiceDetails: 'وردەکارییەکانی پسوڵە', orderItemsTable: 'خشتەی کاڵاکانی داواکاری', financialSummary: 'پوختەی دارایی', selectValues: 'ئەو بەهایانە هەڵبژێرە کە دەتهەوێت لەم چاپەدا دەربکەون.', selectColumns: 'ستوونەکانی خشتە هەڵبژێرە کە دەتهەوێت لەم چاپەدا دەربکەون.', noColumns: 'هیچ ستوونی کاڵا هەڵنەبژێردراوە', logo: 'لۆگۆ', workspaceLogo: 'لۆگۆی شوێنی کار', workspaceName: 'ناوی شوێنی کار', email: 'ئیمەیڵ', madeBy: 'دروستکراوە لەلایەن AtlasERP', page: 'لاپەڕە', pageOf: 'لە', printDate: 'بەرواری چاپ',
        statuses: { draft: 'ڕەشنووس', pending: 'چاوەڕوان', completed: 'تەواوبوو', cancelled: 'هەڵوەشاوە', ordered: 'داواکراو', received: 'وەرگیراو' },
        paymentMethods: { cash: 'کاش', fib: 'FIB', qicard: 'کیو کارد', zaincash: 'زین کاش', fastpay: 'فاست پەی', bank_transfer: 'گواستنەوەی بانکی', loan: 'قەرز', installments: 'قسط' }
    }
} as const

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function formatPrintDateTime(value: string, language: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return { date: '-', time: '-' }

    const locale = resolveAtlasStandardLocale(language) === 'ar'
        ? 'ar-IQ'
        : resolveAtlasStandardLocale(language) === 'ku'
            ? 'ku-Arab-IQ'
            : 'en-CA'
    const datePart = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date).replace(/-/g, '/')
    const timePart = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: resolveAtlasStandardLocale(language) === 'en'
    }).format(date)

    return { date: datePart, time: timePart }
}

function numberToEnglishWords(value: number) {
    const wholeValue = Math.floor(Math.abs(Number(value) || 0))
    if (wholeValue === 0) return 'Zero'

    const underTwenty = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
    ]
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
    const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion']

    const toWordsBelowThousand = (amount: number): string => {
        const parts: string[] = []
        if (amount >= 100) {
            parts.push(`${underTwenty[Math.floor(amount / 100)]} Hundred`)
            amount %= 100
        }
        if (amount >= 20) {
            parts.push(tens[Math.floor(amount / 10)])
            amount %= 10
        }
        if (amount > 0) parts.push(underTwenty[amount])
        return parts.join(' ')
    }

    const parts: string[] = []
    let remaining = wholeValue
    let scaleIndex = 0
    while (remaining > 0 && scaleIndex < scales.length) {
        const chunk = remaining % 1000
        if (chunk > 0) {
            parts.unshift([toWordsBelowThousand(chunk), scales[scaleIndex]].filter(Boolean).join(' '))
        }
        remaining = Math.floor(remaining / 1000)
        scaleIndex += 1
    }

    return parts.join(' ')
}

function numberToArabicWords(value: number) {
    const wholeValue = Math.floor(Math.abs(Number(value) || 0))
    if (wholeValue === 0) return 'صفر'

    const underTwenty = [
        '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
        'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'
    ]
    const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
    const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']
    const scales = [
        { singular: '', dual: '', plural: '' },
        { singular: 'ألف', dual: 'ألفان', plural: 'آلاف' },
        { singular: 'مليون', dual: 'مليونان', plural: 'ملايين' },
        { singular: 'مليار', dual: 'ملياران', plural: 'مليارات' },
        { singular: 'تريليون', dual: 'تريليونان', plural: 'تريليونات' }
    ]

    const toWordsBelowHundred = (amount: number): string => {
        if (amount < 20) return underTwenty[amount]
        const ones = amount % 10
        return ones > 0 ? `${underTwenty[ones]} و${tens[Math.floor(amount / 10)]}` : tens[Math.floor(amount / 10)]
    }

    const toWordsBelowThousand = (amount: number): string => {
        const parts: string[] = []
        if (amount >= 100) {
            parts.push(hundreds[Math.floor(amount / 100)])
            amount %= 100
        }
        if (amount > 0) parts.push(toWordsBelowHundred(amount))
        return parts.join(' و')
    }

    const parts: string[] = []
    let remaining = wholeValue
    let scaleIndex = 0
    while (remaining > 0 && scaleIndex < scales.length) {
        const chunk = remaining % 1000
        if (chunk > 0) {
            const scale = scales[scaleIndex]
            if (scaleIndex === 0) {
                parts.unshift(toWordsBelowThousand(chunk))
            } else if (chunk === 1) {
                parts.unshift(scale.singular)
            } else if (chunk === 2) {
                parts.unshift(scale.dual)
            } else if (chunk >= 3 && chunk <= 10) {
                parts.unshift(`${toWordsBelowThousand(chunk)} ${scale.plural}`)
            } else {
                parts.unshift(`${toWordsBelowThousand(chunk)} ${scale.singular}`)
            }
        }
        remaining = Math.floor(remaining / 1000)
        scaleIndex += 1
    }

    return parts.join(' و')
}

function numberToKurdishWords(value: number) {
    const wholeValue = Math.floor(Math.abs(Number(value) || 0))
    if (wholeValue === 0) return 'سفر'

    const underTwenty = [
        '', 'یەک', 'دوو', 'سێ', 'چوار', 'پێنج', 'شەش', 'حەوت', 'هەشت', 'نۆ',
        'دە', 'یازدە', 'دوازدە', 'سێزدە', 'چواردە', 'پانزە', 'شانزە', 'حەڤدە', 'هەژدە', 'نۆزدە'
    ]
    const tens = ['', '', 'بیست', 'سی', 'چل', 'پەنجا', 'شەست', 'حەفتا', 'هەشتا', 'نەوەت']
    const hundreds = ['', 'سەد', 'دووسەد', 'سێسەد', 'چوارسەد', 'پێنجسەد', 'شەشسەد', 'حەوتسەد', 'هەشتسەد', 'نۆسەد']
    const scales = ['', 'هەزار', 'ملیۆن', 'ملیار', 'تریلیۆن']

    const toWordsBelowHundred = (amount: number): string => {
        if (amount < 20) return underTwenty[amount]
        const ones = amount % 10
        return ones > 0 ? `${tens[Math.floor(amount / 10)]} و ${underTwenty[ones]}` : tens[Math.floor(amount / 10)]
    }

    const toWordsBelowThousand = (amount: number): string => {
        const parts: string[] = []
        if (amount >= 100) {
            parts.push(hundreds[Math.floor(amount / 100)])
            amount %= 100
        }
        if (amount > 0) parts.push(toWordsBelowHundred(amount))
        return parts.join(' و ')
    }

    const parts: string[] = []
    let remaining = wholeValue
    let scaleIndex = 0
    while (remaining > 0 && scaleIndex < scales.length) {
        const chunk = remaining % 1000
        if (chunk > 0) {
            const words = toWordsBelowThousand(chunk)
            parts.unshift(scaleIndex === 0 ? words : `${words} ${scales[scaleIndex]}`)
        }
        remaining = Math.floor(remaining / 1000)
        scaleIndex += 1
    }

    return parts.join(' و ')
}

function numberToWords(value: number, language: string) {
    switch ((language || 'en').split('-')[0]) {
        case 'ar': return numberToArabicWords(value)
        case 'ku': return numberToKurdishWords(value)
        default: return numberToEnglishWords(value)
    }
}

function getBatchDetails(
    item: SalesOrder['items'][number] | PurchaseOrder['items'][number],
    kind: OrderKind
) {
    if (kind === 'purchase') {
        const purchaseItem = item as PurchaseOrder['items'][number]
        return {
            batchNumber: purchaseItem.batchNumber || '',
            expiry: purchaseItem.batchExpiryDate ? formatDate(purchaseItem.batchExpiryDate) : ''
        }
    }

    const salesItem = item as SalesOrder['items'][number]
    const allocations = salesItem.batchAllocations || []
    return {
        batchNumber: allocations.map((allocation) => allocation.batchNumber).filter(Boolean).join(', '),
        expiry: allocations
            .map((allocation) => allocation.expiryDate ? formatDate(allocation.expiryDate) : '')
            .filter(Boolean)
            .join(', ')
    }
}

function contactValues(pair?: WorkspaceContactPair) {
    return [pair?.primary, pair?.nonPrimary].filter((value): value is string => Boolean(value?.trim()))
}

function HideableSection({
    title,
    dialogDescription,
    fields,
    hiddenFields,
    onHiddenFieldChange,
    className
}: {
    title: string
    dialogDescription: string
    fields: HideablePrintField[]
    hiddenFields: Record<string, boolean>
    onHiddenFieldChange?: (key: string, hidden: boolean) => void
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const canConfigure = Boolean(onHiddenFieldChange)
    const visibleFields = fields.filter((field) => !hiddenFields[field.key])
    const openDialog = () => setOpen(true)
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        openDialog()
    }
    const content = visibleFields.length > 0
        ? visibleFields.map((field) => (
            <div key={field.key} className={cn('min-w-0', field.className)}>
                {field.render || (
                    <div className="min-h-[6.5mm] px-2 py-1.5 text-xs">
                        <strong>{field.label} : </strong>{field.value}
                    </div>
                )}
            </div>
        ))
        : <div className="col-span-4 min-h-[6.5mm] border-l border-t border-[#244f87]" />

    const section = (
        <div
            role={canConfigure ? 'button' : undefined}
            tabIndex={canConfigure ? 0 : undefined}
            className={cn(
                'grid grid-cols-4 border-b border-r border-[#244f87] bg-white text-start outline-none',
                canConfigure && 'cursor-pointer transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/50',
                className
            )}
            onClick={canConfigure ? (event) => {
                event.stopPropagation()
                openDialog()
            } : undefined}
            onKeyDown={canConfigure ? handleKeyDown : undefined}
        >
            {content}
        </div>
    )

    if (!canConfigure) return section

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {section}
            <DialogContent className="max-w-md" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                    {fields.map((field) => {
                        const hidden = Boolean(hiddenFields[field.key])
                        return (
                            <button
                                key={field.key}
                                type="button"
                                aria-pressed={hidden}
                                className={cn(
                                    'flex w-full items-start justify-between gap-4 rounded-md border border-border px-3 py-2 text-start text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                                    hidden && 'text-muted-foreground line-through'
                                )}
                                onClick={() => onHiddenFieldChange?.(field.key, !hidden)}
                            >
                                <span className="font-medium">{field.label}</span>
                                {field.value !== undefined ? <span className="text-end">{field.value}</span> : null}
                            </button>
                        )
                    })}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function HideableTable({
    title,
    dialogDescription,
    emptyLabel,
    columns,
    hiddenFields,
    onHiddenFieldChange,
    children
}: {
    title: string
    dialogDescription: string
    emptyLabel: string
    columns: TableColumn[]
    hiddenFields: Record<string, boolean>
    onHiddenFieldChange?: (key: string, hidden: boolean) => void
    children: (visibleColumns: TableColumn[]) => ReactNode
}) {
    const [open, setOpen] = useState(false)
    const canConfigure = Boolean(onHiddenFieldChange)
    const visibleColumns = columns.filter((column) => !hiddenFields[column.key])
    const openDialog = () => setOpen(true)
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        openDialog()
    }

    const table = (
        <div
            role={canConfigure ? 'button' : undefined}
            tabIndex={canConfigure ? 0 : undefined}
            className={cn(
                'min-h-[16mm] outline-none',
                canConfigure && 'cursor-pointer transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/50'
            )}
            onClick={canConfigure ? (event) => {
                event.stopPropagation()
                openDialog()
            } : undefined}
            onKeyDown={canConfigure ? handleKeyDown : undefined}
        >
            {visibleColumns.length > 0 ? children(visibleColumns) : (
                <div className="flex min-h-[16mm] items-center justify-center border text-xs text-slate-500" style={{ borderColor: INK }}>
                    {emptyLabel}
                </div>
            )}
        </div>
    )

    if (!canConfigure) return table

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {table}
            <DialogContent className="max-w-md" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                    {columns.map((column) => {
                        const hidden = Boolean(hiddenFields[column.key])
                        return (
                            <button
                                key={column.key}
                                type="button"
                                aria-pressed={hidden}
                                className={cn(
                                    'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-start text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                                    hidden && 'text-muted-foreground line-through'
                                )}
                                onClick={() => onHiddenFieldChange?.(column.key, !hidden)}
                            >
                                <span className="font-medium">{column.label}</span>
                            </button>
                        )
                    })}
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function AtlasStandardOrderInvoiceTemplate({
    workspaceName,
    printLang,
    order,
    kind,
    iqdPreference = 'IQD',
    logoUrl,
    workspaceFooterContacts,
    businessPartner,
    printedBy,
    componentPositions,
    editableComponents,
    onComponentPositionChange,
    hiddenFields = {},
    onHiddenFieldChange
}: AtlasStandardOrderInvoiceTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const labels = ATLAS_STANDARD_LABELS[resolveAtlasStandardLocale(printLang)]
    const isSales = kind === 'sales'
    const salesOrder = isSales ? order as SalesOrder : null
    const purchaseOrder = !isSales ? order as PurchaseOrder : null
    const counterpartyLabel = isSales
        ? labels.customer
        : labels.supplier
    const counterpartyName = isSales ? salesOrder?.customerName : purchaseOrder?.supplierName
    const issuedAt = formatPrintDateTime(order.createdAt, printLang)
    const logoSrc = resolveLogoSrc(logoUrl)
    const financialKeys = ATLAS_STANDARD_ORDER_HIDDEN_FIELD_KEYS.financialSummary
    const detailsKeys = ATLAS_STANDARD_ORDER_HIDDEN_FIELD_KEYS.invoiceDetails
    const tableKeys = ATLAS_STANDARD_ORDER_HIDDEN_FIELD_KEYS.table
    const currency = order.currency
    const balanceCurrency = businessPartner?.defaultCurrency || currency
    const noteValue = order.notes?.trim() || '-'
    const outstanding = getOrderBalanceAmount(order)
    const paidAmount = getOrderPaidAmount(order)
    const currentPartnerBalance = businessPartner
        ? (isSales ? businessPartner.receivableBalance : businessPartner.payableBalance)
        : null
    const formatPartnerBalance = (value: number | null) => value === null
        ? '-'
        : formatCurrency(value, balanceCurrency, iqdPreference)
    const salesperson = printedBy || order.createdBy || '-'
    const partnerAddress = businessPartner?.address?.trim() || '-'
    const statusLabel = labels.statuses[order.status as keyof typeof labels.statuses] || order.status
    const paymentMethod = order.paymentMethod
        ? labels.paymentMethods[order.paymentMethod as keyof typeof labels.paymentMethods] || order.paymentMethod
        : '-'
    const amountInWords = numberToWords(order.total, printLang)
    const items = order.items || []
    const emptyTableAreaMm = Math.max(0, TABLE_DATA_AREA_MM - (items.length * TABLE_ITEM_ROW_MM))
    const tableColumns: TableColumn[] = [
        { key: tableKeys.number, label: labels.number, width: '5%' },
        { key: tableKeys.product, label: labels.productName, width: '34%' },
        { key: tableKeys.expiry, label: labels.expiry, width: '9%' },
        { key: tableKeys.batchNumber, label: labels.batchNumber, width: '10%' },
        { key: tableKeys.quantity, label: labels.quantity, width: '9%' },
        { key: tableKeys.freeQuantity, label: labels.freeQuantity, width: '9%' },
        { key: tableKeys.price, label: labels.price, width: '12%' },
        { key: tableKeys.total, label: labels.total, width: '12%' }
    ]

    const invoiceDetailFields: HideablePrintField[] = [
        {
            key: detailsKeys.partner,
            label: counterpartyLabel,
            value: counterpartyName || '-',
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{counterpartyLabel} : </strong>{counterpartyName || '-'}</div>
        },
        {
            key: detailsKeys.invoice,
            label: labels.invoice,
            value: isSales ? labels.salesOrder : labels.purchaseOrder,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.invoice} : </strong>{isSales ? labels.salesOrder : labels.purchaseOrder}</div>
        },
        {
            key: detailsKeys.number,
            label: labels.number,
            value: order.orderNumber,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.number} </strong>{order.orderNumber}</div>
        },
        {
            key: detailsKeys.salesPerson,
            label: labels.salesPerson,
            value: salesperson,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.salesPerson} : </strong>{salesperson}</div>
        },
        {
            key: detailsKeys.location,
            label: labels.partnerAddress,
            value: partnerAddress,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.partnerAddress} : </strong>{partnerAddress}</div>
        },
        {
            key: detailsKeys.status,
            label: labels.status,
            value: statusLabel,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.status} : </strong>{statusLabel}</div>
        },
        {
            key: detailsKeys.documentNumber,
            label: labels.documentNumber,
            value: order.orderNumber,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.documentNumber} : </strong>{order.orderNumber}</div>
        },
        {
            key: detailsKeys.invoiceDate,
            label: labels.invoiceDate,
            value: issuedAt.date,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.invoiceDate} : </strong>{issuedAt.date}</div>
        },
        {
            key: detailsKeys.time,
            label: labels.time,
            value: issuedAt.time,
            className: 'border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.time} : </strong>{issuedAt.time}</div>
        }
    ]

    const financialFields: HideablePrintField[] = [
        {
            key: financialKeys.paidAmount,
            label: labels.paidAmount,
            value: formatCurrency(paidAmount, currency, iqdPreference),
            className: 'col-span-4 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.paidAmount} : </strong>{formatCurrency(paidAmount, currency, iqdPreference)}</div>
        },
        {
            key: financialKeys.outstanding,
            label: labels.outstanding,
            value: formatCurrency(outstanding, currency, iqdPreference),
            className: 'col-span-4 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.outstanding} : </strong>{formatCurrency(outstanding, currency, iqdPreference)}</div>
        },
        {
            key: financialKeys.discount,
            label: labels.discount,
            value: formatCurrency(order.discount, currency, iqdPreference),
            className: 'col-span-4 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.discount} : </strong>{formatCurrency(order.discount, currency, iqdPreference)}</div>
        },
        {
            key: financialKeys.currentBalance,
            label: labels.currentBalance,
            value: formatPartnerBalance(currentPartnerBalance),
            className: 'col-span-4 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.currentBalance} : </strong>{formatPartnerBalance(currentPartnerBalance)}</div>
        },
        {
            key: financialKeys.paymentMethod,
            label: labels.paymentMethod,
            value: paymentMethod,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.paymentMethod} : </strong>{paymentMethod}</div>
        },
        {
            key: financialKeys.amountInWords,
            label: labels.amountInWords,
            value: amountInWords,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs">{amountInWords}</div>
        },
        {
            key: financialKeys.printedBy,
            label: labels.printedBy,
            value: salesperson,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.printedBy} : </strong>{salesperson}</div>
        },
        {
            key: financialKeys.notes,
            label: labels.notes,
            value: noteValue,
            className: 'col-span-2 border-l border-t border-[#244f87]',
            render: <div className="min-h-[6.5mm] px-2 py-1.5 text-xs"><strong>{labels.notes} : </strong>{noteValue}</div>
        }
    ]

    const footerAddress = contactValues(workspaceFooterContacts?.address)
    const footerPhone = contactValues(workspaceFooterContacts?.phone)
    const footerEmail = contactValues(workspaceFooterContacts?.email)

    return (
        <div
            dir={isRTL(printLang) ? 'rtl' : 'ltr'}
            className="atlas-standard-order-invoice bg-white text-slate-800"
            style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', padding: '8mm' }}
            data-order-print-page=""
            data-page-width-mm="210"
        >
            <style dangerouslySetInnerHTML={{
                __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
.atlas-standard-order-invoice { color-scheme: light !important; font-family: Arial, Helvetica, sans-serif; }
.atlas-standard-order-invoice table { page-break-inside: auto; }
.atlas-standard-order-invoice tr { page-break-inside: avoid; page-break-after: auto; }
`
            }} />

            <header className="mb-1 flex min-h-[13mm] items-center justify-between border-b-2 px-1 pb-1" style={{ borderColor: INK }}>
                <MovableOrderPrintBlock
                    componentKey={ATLAS_STANDARD_ORDER_MOVABLE_COMPONENT_KEYS.workspaceName}
                    label={labels.workspaceName}
                    position={componentPositions?.[ATLAS_STANDARD_ORDER_MOVABLE_COMPONENT_KEYS.workspaceName]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                    wrapperClassName="shrink-0"
                >
                    <h1 className="text-[18px] font-bold tracking-wide" style={{ color: INK }}>{workspaceName || 'Atlas'}</h1>
                </MovableOrderPrintBlock>
                <MovableOrderPrintBlock
                    componentKey={ATLAS_STANDARD_ORDER_MOVABLE_COMPONENT_KEYS.logo}
                    label={labels.workspaceLogo}
                    position={componentPositions?.[ATLAS_STANDARD_ORDER_MOVABLE_COMPONENT_KEYS.logo]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                    wrapperClassName="shrink-0"
                    handleSide="left"
                >
                    {logoSrc ? (
                        <img src={logoSrc} alt={labels.workspaceLogo} className="max-h-[11mm] max-w-[24mm] object-contain" />
                    ) : (
                        <div className="flex h-[11mm] w-[11mm] items-center justify-center border-[2px] text-[9px] font-bold tracking-[0.1em]" style={{ borderColor: INK, color: INK }}>{labels.logo}</div>
                    )}
                </MovableOrderPrintBlock>
            </header>

            <HideableSection
                title={labels.invoiceDetails}
                dialogDescription={labels.selectValues}
                fields={invoiceDetailFields}
                hiddenFields={hiddenFields}
                onHiddenFieldChange={onHiddenFieldChange}
                className="mb-2"
            />

            <HideableTable
                title={labels.orderItemsTable}
                dialogDescription={labels.selectColumns}
                emptyLabel={labels.noColumns}
                columns={tableColumns}
                hiddenFields={hiddenFields}
                onHiddenFieldChange={onHiddenFieldChange}
            >
                {(visibleColumns) => (
                    <table className="mb-2 w-full table-fixed border-collapse border text-[10px] leading-none" style={{ borderColor: INK }}>
                        <colgroup>
                            {visibleColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
                        </colgroup>
                        <thead>
                            <tr className="h-[8mm] bg-[#e8f0fa] text-center font-bold" style={{ color: '#243b5a' }}>
                                {visibleColumns.map((column) => (
                                    <th
                                        key={column.key}
                                        className="border px-[0.5mm] py-[0.75mm] text-center align-middle text-[9px] leading-[1.2] break-words whitespace-normal"
                                        style={{ borderColor: INK }}
                                    >
                                        {column.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, index) => {
                                const batch = getBatchDetails(item, kind)
                                const paidQuantity = getOrderLinePaidQuantity(item)
                                const unit = item.unit?.trim()
                                const values: Record<string, ReactNode> = {
                                    [tableKeys.number]: index + 1,
                                    [tableKeys.product]: item.productName || '\u00a0',
                                    [tableKeys.expiry]: batch.expiry || '\u00a0',
                                    [tableKeys.batchNumber]: batch.batchNumber || '\u00a0',
                                    [tableKeys.quantity]: unit
                                        ? `${paidQuantity} ${t(`products.units.${unit}`, { defaultValue: unit })}`
                                        : paidQuantity,
                                    [tableKeys.freeQuantity]: getOrderLineFreeBonusQuantity(item) || '\u00a0',
                                    [tableKeys.price]: formatCurrency(item.convertedUnitPrice, currency, iqdPreference),
                                    [tableKeys.total]: formatCurrency(item.lineTotal, currency, iqdPreference)
                                }
                                return (
                                    <tr key={item.id} className="h-[8mm]">
                                        {visibleColumns.map((column) => (
                                            <td
                                                key={column.key}
                                                className={cn(
                                                    'border px-[1.2mm] py-[1mm] text-center align-middle leading-[1.15]',
                                                    column.key === tableKeys.product ? 'break-words whitespace-normal' : 'whitespace-nowrap'
                                                )}
                                                style={{ borderColor: INK }}
                                            >
                                                {values[column.key]}
                                            </td>
                                        ))}
                                    </tr>
                                )
                            })}
                            {emptyTableAreaMm > 0 ? (
                                <tr>
                                    {visibleColumns.map((column) => (
                                            <td
                                                key={column.key}
                                                className="border-x px-1 text-center align-middle"
                                            style={{ borderColor: INK, height: `${emptyTableAreaMm}mm` }}
                                        >
                                            {'\u00a0'}
                                        </td>
                                    ))}
                                </tr>
                            ) : null}
                            <tr className="h-[8mm] bg-[#f5f8fc] font-bold">
                                {visibleColumns.map((column) => {
                                    const value = column.key === tableKeys.quantity
                                        ? items.reduce((sum, item) => sum + getOrderLinePaidQuantity(item), 0)
                                        : column.key === tableKeys.freeQuantity
                                            ? items.reduce((sum, item) => sum + getOrderLineFreeBonusQuantity(item), 0) || '\u00a0'
                                            : column.key === tableKeys.total
                                                ? formatCurrency(order.total, currency, iqdPreference)
                                                : '\u00a0'
                                    return (
                                        <td key={column.key} className="border px-[1.2mm] py-[1mm] text-center align-middle leading-[1.15] whitespace-nowrap" style={{ borderColor: INK }}>
                                            {value}
                                        </td>
                                    )
                                })}
                            </tr>
                        </tbody>
                    </table>
                )}
            </HideableTable>

            <HideableSection
                title={labels.financialSummary}
                dialogDescription={labels.selectValues}
                fields={financialFields}
                hiddenFields={hiddenFields}
                onHiddenFieldChange={onHiddenFieldChange}
                className="mb-2"
            />

            <div className="flex min-h-[13mm] items-start justify-between gap-4 text-[10px]" style={{ color: '#243b5a' }}>
                <div className="pt-1 font-bold">{footerEmail.length ? `${labels.email}: ${footerEmail.join(' - ')}` : ''}</div>
                <div className="max-w-[125mm] text-end leading-4">
                    {footerAddress.length ? <div>{footerAddress.join(' - ')}</div> : null}
                    {footerPhone.length ? <div>{footerPhone.join(' - ')}</div> : null}
                </div>
            </div>

            <footer className="grid grid-cols-3 border-t pt-1 text-center text-[10px] font-bold" style={{ borderColor: INK, color: '#334c70' }}>
                <span>{labels.madeBy}</span>
                <span>{labels.page} 1 {labels.pageOf} 1</span>
                <span>{labels.printDate}: {issuedAt.date}</span>
            </footer>
        </div>
    )
}
