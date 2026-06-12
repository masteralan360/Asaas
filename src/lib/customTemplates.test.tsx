import { beforeAll, describe, expect, it, vi } from 'vitest'

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

let customTemplates: typeof import('@/lib/customTemplates')
let PartnerDetailsPrintTemplate: typeof import('@/ui/components/crm/PartnerDetailsPrintTemplate')['PartnerDetailsPrintTemplate']

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
    ;({ PartnerDetailsPrintTemplate } = await import('@/ui/components/crm/PartnerDetailsPrintTemplate'))
}, 30_000)

describe('Partner Details custom print template', () => {
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

    it('uses the native Partner Details A4 layout without editable fields', () => {
        const target = customTemplates.getCustomTemplateTarget(customTemplates.PARTNER_DETAILS_TEMPLATE_KEY)
        expect(target).toBeDefined()

        const preview = customTemplates.createCustomTemplatePreview(target!, {
            workspaceName: 'Atlas Test',
            printLang: 'en'
        })
        const element = preview.createElement({})

        expect(preview.fields).toEqual([])
        expect(preview.page).toEqual({
            widthMm: 210,
            heightMm: 297
        })
        expect(preview.fixedPrintLang).toBe('en')
        expect(element.type).toBe(PartnerDetailsPrintTemplate)
        expect(element.props.workspaceName).toBe('Atlas Test')
        expect(element.props.printLang).toBe('en')
    })
})
