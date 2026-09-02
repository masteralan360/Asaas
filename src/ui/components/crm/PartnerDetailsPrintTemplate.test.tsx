import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

vi.mock('@/lib/utils', () => ({
    cn: (...inputs: Array<string | false | null | undefined>) => inputs.filter(Boolean).join(' '),
    formatCurrency: (amount: number, currency: string) => `${amount} ${currency}`,
    formatDate: (value: string) => value.slice(0, 10),
    formatDateTime: (value: string) => value.slice(0, 16)
}))

vi.mock('@/services/platformService', () => ({
    platformService: {
        convertFileSrc: (path: string) => path
    }
}))

import {
    PartnerDetailsPrintTemplate,
    PARTNER_DETAILS_MOVABLE_COMPONENT_KEYS,
    type PartnerDetailsPrintData
} from './PartnerDetailsPrintTemplate'

const basePartnerPrintData: PartnerDetailsPrintData = {
    partner: {
        partnerName: 'Business Partner1',
        role: 'both',
        phone: '7701234566',
        defaultCurrency: 'iqd',
        createdAt: '2026-05-01T00:00:00.000Z'
    },
    period: {
        type: 'allTime'
    },
    generatedAt: '2026-07-06T18:51:00.000Z',
    loanSummary: {
        remainingReceivable: 0,
        remainingPayable: 0,
        paymentsReceived: 0,
        paymentsMade: 0
    },
    metrics: {
        moneyIn: 0,
        moneyOut: 0
    },
    relationshipSummary: {
        receivable: 0,
        payable: 0
    },
    providedByYou: [],
    providedByPartner: [],
    salesOrders: [],
    purchaseOrders: [],
    topProducts: []
}

async function renderPartnerPrint(printLang: 'ar' | 'en') {
    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
        resources: {
            ar: {
                translation: {
                    businessPartners: {
                        roles: { both: 'RTL_ROLE' },
                        incomingCash: 'RTL_INCOMING',
                        outgoingCash: 'RTL_OUTGOING',
                        whoOwesWhom: 'RTL_WHO'
                    }
                }
            },
            en: {
                translation: {
                    businessPartners: {
                        roles: { both: 'BOTH_ROLE' },
                        incomingCash: 'Incoming Cash',
                        outgoingCash: 'Outgoing Cash',
                        whoOwesWhom: 'Who owes whom?'
                    }
                }
            }
        },
        lng: printLang,
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
        react: { useSuspense: false }
    })

    return renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
            <PartnerDetailsPrintTemplate
                workspaceName="Atlas"
                printLang={printLang}
                data={basePartnerPrintData}
            />
        </I18nextProvider>
    )
}

describe('PartnerDetailsPrintTemplate', () => {
    it('does not apply letter spacing to Arabic/Kurdish print labels', async () => {
        const html = await renderPartnerPrint('ar')

        expect(html).toContain('dir="rtl"')
        expect(html).toContain('class="block text-[10px] font-semibold text-slate-500">RTL_ROLE')
        expect(html).toContain('class="text-[10px] text-slate-500">RTL_INCOMING')
        expect(html).toContain('class="mb-2 text-xs font-semibold text-slate-600">RTL_WHO')
    })

    it('keeps compact uppercase styling for English print labels', async () => {
        const html = await renderPartnerPrint('en')

        expect(html).toContain('dir="ltr"')
        expect(html).toContain('class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">BOTH_ROLE')
        expect(html).toContain('class="text-[10px] text-slate-500 uppercase tracking-wide">Incoming Cash')
        expect(html).toContain('class="mb-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">Who owes whom?')
    })

    it('marks partner print blocks so they remain intact across A4 pages', async () => {
        const html = await renderPartnerPrint('en')

        expect(html).toContain('data-partner-details-print="true"')
        expect(html).toContain('data-pdf-keep-together="true"')
        expect(html).toContain('page-break-inside: avoid')
    })

    it('renders each partner detail section as a separate movable component', async () => {
        const html = await renderPartnerPrint('en')

        Object.values(PARTNER_DETAILS_MOVABLE_COMPONENT_KEYS).forEach((key) => {
            if (key === PARTNER_DETAILS_MOVABLE_COMPONENT_KEYS.ordersHeader
                || key === PARTNER_DETAILS_MOVABLE_COMPONENT_KEYS.salesOrders
                || key === PARTNER_DETAILS_MOVABLE_COMPONENT_KEYS.purchaseOrders) {
                return
            }
            expect(html).toContain(`data-order-print-component="${key}"`)
        })
    })
})
