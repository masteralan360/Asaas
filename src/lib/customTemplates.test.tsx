import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/services/pdfGenerator', () => ({
    generateTemplatePdf: vi.fn()
}))
vi.mock('@/services/platformService', () => ({
    platformService: {
        convertFileSrc: (path: string) => path
    }
}))
vi.mock('@/ui/components/real-estate/RealEstateBuyPrintTemplate', () => ({
    RealEstateBuyPrintTemplate: () => null
}))
vi.mock('@/ui/components/SaleReceipt', () => ({
    SALE_RECEIPT_TEMPLATE_FIELD_KEYS: {
        showExchangeRateSnapshots: 'showExchangeRateSnapshots',
        showOriginalCurrencyPrice: 'showOriginalCurrencyPrice',
        thankYou: 'thankYou',
        keepRecord: 'keepRecord'
    },
    SaleReceiptBase: () => null
}))
vi.mock('@/ui/components/ModernA4InvoiceTemplate', () => ({
    ModernA4InvoiceTemplate: () => null
}))
vi.mock('@/ui/components/ProfessionalA4InvoiceTemplate', () => ({
    ProfessionalA4InvoiceTemplate: () => null,
    PROFESSIONAL_A4_TABLE_ROW_COUNT: 10,
    PROFESSIONAL_A4_MOVABLE_COMPONENT_KEYS: {
        logo: 'logo',
        qrCode: 'qrCode',
        workspaceName: 'workspaceName',
        title: 'title',
        subtitle: 'subtitle',
        customer: 'customer',
        saleSummary: 'saleSummary',
        created: 'created',
        payment: 'payment',
        itemsTable: 'itemsTable',
        totals: 'totals',
        terms: 'terms',
        exchangeRates: 'exchangeRates',
        contacts: 'contacts',
        generatedBy: 'generatedBy'
    }
}))

let customTemplates: typeof import('@/lib/customTemplates')
let ProfessionalA4InvoiceTemplate: typeof import('@/ui/components/ProfessionalA4InvoiceTemplate')['ProfessionalA4InvoiceTemplate']
let PartnerDetailsPrintTemplate: typeof import('@/ui/components/crm/PartnerDetailsPrintTemplate')['PartnerDetailsPrintTemplate']
let OrderDetailsPrintTemplate: typeof import('@/ui/components/orders/OrderPrintTemplates')['OrderDetailsPrintTemplate']

beforeAll(async () => {
    vi.stubGlobal('window', {
        location: { hash: '' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    })
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
    })
    vi.stubGlobal('document', {
        dir: '',
        documentElement: {
            lang: '',
            dir: ''
        }
    })

    customTemplates = await import('@/lib/customTemplates')
    ;({ ProfessionalA4InvoiceTemplate } = await import('@/ui/components/ProfessionalA4InvoiceTemplate'))
    ;({ PartnerDetailsPrintTemplate } = await import('@/ui/components/crm/PartnerDetailsPrintTemplate'))
    ;({ OrderDetailsPrintTemplate } = await import('@/ui/components/orders/OrderPrintTemplates'))
}, 30_000)

describe('Sales History custom A4 templates', () => {
    it('registers modern and professional A4 sales history targets', () => {
        expect(customTemplates.SALES_HISTORY_A4_TEMPLATE_KEYS).toEqual([
            customTemplates.SALES_HISTORY_MODERN_A4_TEMPLATE_KEY,
            customTemplates.SALES_HISTORY_PROFESSIONAL_A4_TEMPLATE_KEY
        ])

        const professionalTarget = customTemplates.getCustomTemplateTarget(customTemplates.SALES_HISTORY_PROFESSIONAL_A4_TEMPLATE_KEY)

        expect(professionalTarget).toMatchObject({
            moduleTypeKey: customTemplates.SALES_HISTORY_PROFESSIONAL_A4_TEMPLATE_KEY,
            workspaceModuleKey: 'sales_history',
            typeLabel: 'Professional A4 Print',
            nativeTemplateAvailable: true,
            printFormat: 'a4',
            page: {
                widthMm: 210,
                heightMm: 297
            }
        })
    })

    it('uses the professional A4 layout with movable components', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.SALES_HISTORY_PROFESSIONAL_A4_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const componentPositions = {
            itemsTable: { x: 4, y: 8 },
            totals: { x: -6, y: 3 }
        }
        const onComponentPositionChange = vi.fn()
        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'en'
        })
        const element = preview.createElement({
            hideUnit: 'true',
            hideDiscount: 'true'
        }, undefined, undefined, {
            editableComponents: true,
            componentPositions,
            onComponentPositionChange
        })

        expect(preview.fields).toEqual([
            expect.objectContaining({ key: 'hideUnit', value: 'false', type: 'boolean' }),
            expect.objectContaining({ key: 'hideDiscount', value: 'false', type: 'boolean' }),
            expect.objectContaining({ key: 'tableRowCount', value: '10', type: 'number' })
        ])
        expect(preview.movableComponents?.map((component) => component.key)).toEqual([
            'logo',
            'qrCode',
            'workspaceName',
            'title',
            'subtitle',
            'customer',
            'saleSummary',
            'created',
            'payment',
            'itemsTable',
            'totals',
            'terms',
            'exchangeRates',
            'contacts',
            'generatedBy'
        ])
        expect(preview.fixedPrintLang).toBe('en')
        expect(element.type).toBe(ProfessionalA4InvoiceTemplate)
        expect(element.props.workspaceName).toBe('Atlas Test')
        expect(element.props.hideUnit).toBe(true)
        expect(element.props.hideDiscount).toBe(true)
        expect(element.props.componentPositions).toBe(componentPositions)
        expect(element.props.editableComponents).toBe(true)
        expect(element.props.onComponentPositionChange).toBe(onComponentPositionChange)
    })
})

describe('Partner Details custom print template', () => {
    it('stores and validates the resolved workspace print language', () => {
        const layout = customTemplates.stampCustomTemplatePrintLanguage({
            version: 1,
            moduleTypeKey: customTemplates.PARTNER_DETAILS_TEMPLATE_KEY,
            page: { widthMm: 210, heightMm: 297 },
            fields: {},
            annotations: [],
            texts: [],
            images: [],
            updatedAt: new Date().toISOString()
        }, 'auto', 'ar-IQ')
        const row = {
            id: 'arabic-partner-template',
            module_type_key: customTemplates.PARTNER_DETAILS_TEMPLATE_KEY,
            layout_json: layout
        }

        expect(layout.printLanguage).toBe('ar')
        expect(customTemplates.getStoredCustomTemplatePrintLanguage(row)).toBe('ar')
        expect(customTemplates.isCustomTemplatePrintLanguageCompatible(row, 'ar')).toBe(true)
        expect(customTemplates.isCustomTemplatePrintLanguageCompatible(row, 'en')).toBe(false)
    })

    it('treats legacy templates without a saved print language as incompatible', () => {
        const row = {
            id: 'legacy-template',
            module_type_key: customTemplates.PARTNER_DETAILS_TEMPLATE_KEY,
            layout_json: {
                version: 1,
                moduleTypeKey: customTemplates.PARTNER_DETAILS_TEMPLATE_KEY,
                page: { widthMm: 210, heightMm: 297 },
                fields: {},
                annotations: [],
                texts: [],
                images: [],
                updatedAt: new Date().toISOString()
            }
        }

        expect(customTemplates.getStoredCustomTemplatePrintLanguage(row)).toBeNull()
        expect(customTemplates.isCustomTemplatePrintLanguageCompatible(row, 'en')).toBe(false)
    })

    it('registers an A4 CRM template target', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.PARTNER_DETAILS_TEMPLATE_KEY)

        expect(target).toMatchObject({
            moduleTypeKey: customTemplates.PARTNER_DETAILS_TEMPLATE_KEY,
            workspaceModuleKey: 'crm',
            nativeTemplateAvailable: true,
            printFormat: 'a4',
            page: {
                widthMm: 210,
                heightMm: 297
            }
        })
    })

    it('uses the native Partner Details A4 layout with section toggles', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.PARTNER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'en'
        })
        const element = preview.createElement({})

        expect(preview.fields).toEqual([
            expect.objectContaining({
                key: customTemplates.PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showWhoOwesWhom,
                value: 'true',
                type: 'boolean'
            }),
            expect.objectContaining({
                key: customTemplates.PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showOrders,
                value: 'false',
                type: 'boolean'
            })
        ])
        expect(preview.page).toEqual({
            widthMm: 210,
            heightMm: 297
        })
        expect(preview.fixedPrintLang).toBe('en')
        expect(element.type).toBe(PartnerDetailsPrintTemplate)
        expect(element.props.workspaceName).toBe('Atlas Test')
        expect(element.props.printLang).toBe('en')
        expect(element.props.showWhoOwesWhom).toBe(true)
        expect(element.props.showOrders).toBe(false)
    })

    it('renders the focused loan summary, cash flow, and two activity tables', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.PARTNER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'en'
        })
        const html = renderToStaticMarkup(preview.createElement({}))

        expect(html).toContain('Remaining Receivable Loans')
        expect(html).toContain('Remaining Payable Loans')
        expect(html).toContain('Loan Payment Received By Us')
        expect(html).toContain('Loan Payment Made to the Partner')
        expect(html).toContain('Incoming Cash')
        expect(html).toContain('Outgoing Cash')
        expect(html).toContain('Net Flow')
        expect(html).toContain('Provided by you')
        expect(html).toContain('Provided by partner')
        expect(html).not.toContain('Unified Activity Timeline')
        expect(html).not.toContain('Average Document')
    })

    it('renders the optional orders back page when enabled', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.PARTNER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'en'
        })
        const html = renderToStaticMarkup(preview.createElement({
            [customTemplates.PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showWhoOwesWhom]: 'false',
            [customTemplates.PARTNER_DETAILS_TEMPLATE_FIELD_KEYS.showOrders]: 'true'
        }))

        expect(html).not.toContain('Who owes whom?')
        expect(html).toContain('Partner Orders')
        expect(html).toContain('Sales from Atlas Test to Primary Contact')
        expect(html).toContain('Purchases supplied by Primary Contact to Atlas Test')
        expect(html).toContain('SO-00042')
        expect(html).toContain('PO-00019')
        expect(html).toContain('page-break-before:always')
    })
})

describe('Order Details custom print template', () => {
    it('registers an A4 CRM order target', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.ORDER_DETAILS_TEMPLATE_KEY)

        expect(target).toMatchObject({
            moduleTypeKey: customTemplates.ORDER_DETAILS_TEMPLATE_KEY,
            workspaceModuleKey: 'crm',
            nativeTemplateAvailable: true,
            printFormat: 'a4',
            page: {
                widthMm: 210,
                heightMm: 297
            }
        })
    })

    it('uses the native order A4 layout with print visibility toggles', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.ORDER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'ku'
        })
        const componentPositions = {
            customer: { x: 12, y: -4 },
            orderItems: { x: 0, y: 20 },
            totals: { x: -8, y: 12 }
        }
        const onComponentPositionChange = vi.fn()
        const element = preview.createElement({
            [customTemplates.ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideUnit]: 'true',
            [customTemplates.ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideDiscount]: 'true'
        }, undefined, undefined, {
            editableComponents: true,
            componentPositions,
            onComponentPositionChange
        })

        expect(preview.fields).toEqual([
            expect.objectContaining({
                key: customTemplates.ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideUnit,
                value: 'false',
                type: 'boolean'
            }),
            expect.objectContaining({
                key: customTemplates.ORDER_DETAILS_TEMPLATE_FIELD_KEYS.hideDiscount,
                value: 'false',
                type: 'boolean'
            })
        ])
        expect(preview.movableComponents?.map((component) => component.key)).toEqual([
            'customer',
            'commercials',
            'created',
            'expectedDelivery',
            'orderItems',
            'totals',
            'logo',
            'qrCode',
            'workspaceName',
            'title',
            'subtitle',
            'contacts',
            'notes'
        ])
        expect(preview.fixedPrintLang).toBe('ku')
        expect(element.type).toBe(OrderDetailsPrintTemplate)
        expect(element.props.workspaceName).toBe('Atlas Test')
        expect(element.props.printLang).toBe('ku')
        expect(element.props.order.orderNumber).toBe('SO-00042')
        expect(element.props.kind).toBe('sales')
        expect(element.props.hideUnit).toBe(true)
        expect(element.props.hideDiscount).toBe(true)
        expect(element.props.componentPositions).toBe(componentPositions)
        expect(element.props.editableComponents).toBe(true)
        expect(element.props.onComponentPositionChange).toBe(onComponentPositionChange)

        const html = renderToStaticMarkup(element)
        expect(html.match(/data-order-print-component=/g)).toHaveLength(12)
        expect(html).toContain('data-order-print-component="customer"')
        expect(html).toContain('translate(12mm, -4mm)')
        expect(html).toContain('aria-label="Move ')
        expect(html).toContain('data-order-print-component="orderItems"')
        expect(html).toContain('data-order-print-component="totals"')
    })

    it('preserves movable component positions when reading a saved layout', () => {
        const componentPositions = {
            customer: { x: 10, y: 5 },
            commercials: { x: -6, y: 8 }
        }
        const layout = customTemplates.readCustomTemplateLayout({
            id: 'movable-order-template',
            module_type_key: customTemplates.ORDER_DETAILS_TEMPLATE_KEY,
            layout_json: {
                version: 1,
                moduleTypeKey: customTemplates.ORDER_DETAILS_TEMPLATE_KEY,
                page: { widthMm: 210, heightMm: 297 },
                fields: {},
                componentPositions,
                annotations: [],
                texts: [],
                images: [],
                updatedAt: new Date().toISOString()
            }
        })

        expect(layout?.componentPositions).toEqual(componentPositions)
    })

    it('applies saved component positions to the printable custom layout without editor controls', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.ORDER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const html = renderToStaticMarkup(customTemplates.renderCustomTemplateLayoutElement({
            target: target!,
            layout: {
                version: 1,
                moduleTypeKey: customTemplates.ORDER_DETAILS_TEMPLATE_KEY,
                page: { widthMm: 210, heightMm: 297 },
                fields: {},
                componentPositions: {
                    orderItems: { x: 7, y: 15 },
                    totals: { x: -4, y: 9 }
                },
                annotations: [],
                texts: [{
                    id: 'phone-number',
                    text: '0770 199 0012',
                    x: 20,
                    y: 30,
                    width: 45,
                    rotation: 0
                }],
                images: [],
                updatedAt: new Date().toISOString()
            },
            values: {},
            options: {
                workspaceName: 'Atlas Test',
                printLang: 'ku'
            }
        }))

        expect(html).toContain('data-order-print-component="orderItems"')
        expect(html).toContain('translate(7mm, 15mm)')
        expect(html).toContain('translate(-4mm, 9mm)')
        expect(html).toContain('dir="ltr" class="absolute whitespace-pre-wrap')
        expect(html).toContain('0770 199 0012')
        expect(html).not.toContain('order-template-move-handle absolute')
    })
})
