import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileText, Printer, Settings, TrendingDown, TrendingUp } from 'lucide-react'
import { Link, useLocation } from 'wouter'
import { useTranslation } from 'react-i18next'
import type { i18n as I18n } from 'i18next'

import { isSupabaseConfigured, useAuth } from '@/auth'
import {
    PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY,
    buildCustomTemplateLayoutPdf,
    createCustomTemplatePreview,
    getCustomTemplatePrintLanguageWarning,
    getCustomTemplateTarget,
    getStoredCustomTemplateLabel,
    isCustomTemplatePrintLanguageCompatible,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import {
    buildPartnerAccountStatementLedger,
    type PartnerAccountStatementCurrencyLedger,
    type PartnerAccountStatementEntry,
    type PartnerAccountStatementEntryKind,
    type PartnerAccountStatementPeriod
} from '@/lib/partnerAccountStatement'
import {
    getPartnerAccountStatementEntryDescription,
    getPartnerAccountStatementEntryDetail
} from '@/lib/partnerAccountStatementPresentation'
import { getDateRangeBounds } from '@/lib/dateRangeFilters'
import { getLoanDetailsPath } from '@/lib/loanPresentation'
import type { CustomTemplateLayout } from '@/lib/pdfPreviewStore'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { usePartnerAccountStatement } from '@/hooks/usePartnerAccountStatement'
import { isAgentBusinessPartnerRole, useWorkspaceContacts } from '@/local-db'
import type { DateRangeType } from '@/context/DateRangeContext'
import type { PrintFormat } from '@/services/pdfGenerator'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    DateRangeFilters,
    PrintPreviewModal,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Switch
} from '@/ui/components'
import { PartnerAutocompleteInput } from '@/ui/components/crm/PartnerAutocompleteInput'
import type { PartnerAccountStatementPrintData } from '@/ui/components/crm/PartnerAccountStatementPrintTemplate'
import { useWorkspace } from '@/workspace'

const ACCOUNT_STATEMENT_PATH = '/business-partners/account-statement'

function readPartnerSelection(location: string) {
    const searchParams = new URLSearchParams(location.split('?')[1] || '')
    return {
        id: searchParams.get('partnerId'),
        name: searchParams.get('partnerName') || ''
    }
}

function entryLabel(
    kind: PartnerAccountStatementEntryKind,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    const labels: Record<PartnerAccountStatementEntryKind, string> = {
        sales_order: t('orders.tabs.sales', { defaultValue: 'Sales Order' }),
        sales_order_return: t('businessPartners.accountStatement.salesOrderReturn', { defaultValue: 'Sales order return' }),
        purchase_order: t('orders.tabs.purchase', { defaultValue: 'Purchase Order' }),
        incoming_payment: t('businessPartners.accountStatement.paymentReceived', { defaultValue: 'Payment received' }),
        outgoing_payment: t('businessPartners.accountStatement.paymentMade', { defaultValue: 'Payment made' }),
        direct_transaction: t('ledger.type.direct_transaction', { defaultValue: 'Direct Transaction' }),
        loan_disbursal: t('businessPartners.accountStatement.loanMovement', { defaultValue: 'Loan movement' }),
        loan_repayment: t('businessPartners.accountStatement.loanRepayment', { defaultValue: 'Loan repayment' }),
        agent_commission: t('salesAgentCommissions.title', { defaultValue: 'Sales agent commission' }),
        delivery_post: t('postService.title', { defaultValue: 'Post Service' })
    }
    return labels[kind]
}

function balanceLabel(balance: number, t: (key: string, options?: Record<string, unknown>) => string) {
    if (balance > 0.000001) return t('businessPartners.accountStatement.dueFromPartner', { defaultValue: 'Due from partner' })
    if (balance < -0.000001) return t('businessPartners.accountStatement.dueToPartner', { defaultValue: 'Due to partner' })
    return t('businessPartners.accountStatement.settled', { defaultValue: 'Settled' })
}

function balanceClass(balance: number) {
    if (balance > 0.000001) return 'text-emerald-600'
    if (balance < -0.000001) return 'text-yellow-500'
    return ''
}

function formatStatementQuantity(quantity: number | null | undefined, unit: string | null | undefined, language: string) {
    if (quantity === null || quantity === undefined) return '—'
    const value = new Intl.NumberFormat(language, { maximumFractionDigits: 6 }).format(quantity)
    return unit ? `${value} ${unit}` : value
}

function entrySourcePath(entry: PartnerAccountStatementEntry) {
    if (entry.source?.recordType === 'order') {
        return `/orders/${entry.source.recordId}`
    }
    if (entry.source?.recordType === 'loan') {
        return getLoanDetailsPath(entry.source.loanCategory, entry.source.recordId)
    }
    if (entry.source?.recordType === 'delivery_ledger_entry') {
        return '/post-service'
    }
    return null
}

function LedgerCard({
    ledger,
    iqdPreference,
    t,
    i18n,
    language,
    showItemColumns,
    onNavigate
}: {
    ledger: PartnerAccountStatementCurrencyLedger
    iqdPreference: Parameters<typeof formatCurrency>[2]
    t: (key: string, options?: Record<string, unknown>) => string
    i18n: I18n
    language: string
    showItemColumns: boolean
    onNavigate: (path: string) => void
}) {
    const display = (amount: number) => formatCurrency(Math.abs(amount), ledger.currency, iqdPreference)
    return (
        <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3 border-b bg-muted/20 py-4">
                <div>
                    <CardTitle className="text-base">
                        {t('businessPartners.accountStatement.accountActivity', { defaultValue: 'Account Activity' })}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {balanceLabel(ledger.closingBalance, t)}
                    </p>
                </div>
                <span className="rounded-md border bg-background px-2 py-1 text-xs font-bold uppercase tracking-wide">
                    {ledger.currency}
                </span>
            </CardHeader>
            <CardContent className="p-0">
                <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
                    {[
                        ['businessPartners.accountStatement.openingBalance', 'Opening balance', ledger.openingBalance],
                        ['businessPartners.accountStatement.debit', 'Debit', ledger.debitTotal],
                        ['businessPartners.accountStatement.credit', 'Credit', ledger.creditTotal],
                        ['businessPartners.accountStatement.balance', 'Balance', ledger.closingBalance]
                    ].map(([key, fallback, amount], index) => (
                        <div key={String(key)} className={cn('min-w-0 p-3 sm:p-4', index > 1 && 'border-t sm:border-t-0')}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {t(String(key), { defaultValue: String(fallback) })}
                            </div>
                            <div className={cn(
                                'mt-1 truncate text-sm font-black tabular-nums',
                                index === 3 && balanceClass(ledger.closingBalance)
                            )}>
                                {display(Number(amount))}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableHead>{t('common.date', { defaultValue: 'Date' })}</TableHead>
                                <TableHead>{t('common.reference', { defaultValue: 'Reference' })}</TableHead>
                                <TableHead>{t('common.type', { defaultValue: 'Type' })}</TableHead>
                                <TableHead>{t('common.description', { defaultValue: 'Description' })}</TableHead>
                                {showItemColumns ? (
                                    <>
                                        <TableHead>{t('businessPartners.accountStatement.item', { defaultValue: 'Item' })}</TableHead>
                                        <TableHead className="text-right">{t('businessPartners.accountStatement.quantity', { defaultValue: 'Quantity' })}</TableHead>
                                    </>
                                ) : null}
                                <TableHead className="text-right">{t('businessPartners.accountStatement.debit', { defaultValue: 'Debit' })}</TableHead>
                                <TableHead className="text-right">{t('businessPartners.accountStatement.credit', { defaultValue: 'Credit' })}</TableHead>
                                <TableHead className="text-right">{t('businessPartners.accountStatement.balance', { defaultValue: 'Balance' })}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {Math.abs(ledger.openingBalance) > 0.000001 ? (
                                <TableRow className="bg-muted/20 font-medium">
                                    <TableCell colSpan={showItemColumns ? 6 : 4}>{t('businessPartners.accountStatement.openingBalance', { defaultValue: 'Opening balance' })}</TableCell>
                                    <TableCell className="text-right tabular-nums">{ledger.openingBalance > 0 ? display(ledger.openingBalance) : '—'}</TableCell>
                                    <TableCell className="text-right tabular-nums">{ledger.openingBalance < 0 ? display(ledger.openingBalance) : '—'}</TableCell>
                                    <TableCell className={cn('text-right font-bold tabular-nums', balanceClass(ledger.openingBalance))}>
                                        {display(ledger.openingBalance)}
                                    </TableCell>
                                </TableRow>
                            ) : null}
                            {ledger.entries.map((entry) => {
                                const sourcePath = entrySourcePath(entry)
                                const description = getPartnerAccountStatementEntryDescription(entry, t)
                                const detail = getPartnerAccountStatementEntryDetail(entry, { t, i18n, language })
                                const row = (
                                    <TableRow className="cursor-context-menu">
                                        <TableCell className="whitespace-nowrap">{formatDate(entry.date)}</TableCell>
                                        <TableCell className="max-w-40 font-medium break-words">{entry.reference}</TableCell>
                                        <TableCell className="whitespace-nowrap text-muted-foreground">{entryLabel(entry.kind, t)}</TableCell>
                                        <TableCell className="min-w-48 whitespace-pre-wrap">
                                            <div>{description}</div>
                                            {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
                                        </TableCell>
                                        {showItemColumns ? (
                                            <>
                                                <TableCell className="min-w-40 whitespace-pre-wrap">{entry.itemName || '—'}</TableCell>
                                                <TableCell className="text-right tabular-nums whitespace-nowrap">
                                                    {formatStatementQuantity(entry.quantity, entry.unit, language)}
                                                </TableCell>
                                            </>
                                        ) : null}
                                        <TableCell className="text-right font-medium tabular-nums">{entry.delta > 0 ? display(entry.delta) : '—'}</TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">{entry.delta < 0 ? display(entry.delta) : '—'}</TableCell>
                                        <TableCell className={cn('text-right font-bold tabular-nums', balanceClass(entry.runningBalance))}>
                                            {display(entry.runningBalance)}
                                        </TableCell>
                                    </TableRow>
                                )

                                return (
                                    <ContextMenu key={entry.id}>
                                        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                                        <ContextMenuContent className="w-52">
                                            <ContextMenuItem
                                                className="gap-2"
                                                disabled={!sourcePath}
                                                onSelect={() => {
                                                    if (sourcePath) onNavigate(sourcePath)
                                                }}
                                            >
                                                <FileText className="h-4 w-4" />
                                                {sourcePath
                                                    ? t('common.view', { defaultValue: 'View' })
                                                    : t('businessPartners.accountStatement.sourceViewUnavailable', { defaultValue: 'No source view is available' })}
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                )
                            })}
                            <TableRow className="bg-muted/30 font-bold hover:bg-muted/30">
                                <TableCell colSpan={showItemColumns ? 6 : 4} className="text-right">{t('common.total', { defaultValue: 'Total' })}</TableCell>
                                <TableCell className="text-right tabular-nums">{display(ledger.debitTotal)}</TableCell>
                                <TableCell className="text-right tabular-nums">{display(ledger.creditTotal)}</TableCell>
                                <TableCell className={cn('text-right tabular-nums', balanceClass(ledger.closingBalance))}>
                                    {display(ledger.closingBalance)}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

export function AccountStatements() {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { features, hasFeature, workspaceName, isLocalMode } = useWorkspace()
    const workspaceId = user?.workspaceId
    const [location, navigate] = useLocation()
    const urlPartnerSelection = useMemo(() => readPartnerSelection(location), [location])
    const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(urlPartnerSelection.id)
    const [partnerQuery, setPartnerQuery] = useState(urlPartnerSelection.name)
    const [dateRange, setDateRange] = useState<DateRangeType>('month')
    const [customDates, setCustomDates] = useState({ start: '', end: '' })
    const [customTemplates, setCustomTemplates] = useState<StoredCustomTemplateRow[]>([])
    const [selectedPrintTemplate, setSelectedPrintTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false)
    const [isStatementSettingsOpen, setIsStatementSettingsOpen] = useState(false)
    const [showOrderItems, setShowOrderItems] = useState(false)
    const workspaceContacts = useWorkspaceContacts(workspaceId)

    useEffect(() => {
        setSelectedPartnerId(urlPartnerSelection.id)
        if (urlPartnerSelection.id) {
            setPartnerQuery(urlPartnerSelection.name)
        }
    }, [urlPartnerSelection])

    const statementPeriod = useMemo<PartnerAccountStatementPeriod>(() => {
        if (dateRange === 'custom') {
            return {
                type: 'custom',
                start: customDates.start || undefined,
                end: customDates.end || undefined
            }
        }
        if (dateRange === 'allTime') return { type: 'allTime' }

        const { start, end } = getDateRangeBounds(dateRange, customDates)
        if (dateRange === 'yesterday') {
            return {
                type: 'custom',
                start: start?.toISOString(),
                end: end ? new Date(end.getTime() - 1).toISOString() : undefined
            }
        }
        return {
            type: dateRange,
            start: start?.toISOString(),
            end: end ? new Date(end.getTime() - 1).toISOString() : undefined
        }
    }, [customDates, dateRange])
    const { partner, statementData } = usePartnerAccountStatement(workspaceId, selectedPartnerId, statementPeriod)
    const isAgentStatement = isAgentBusinessPartnerRole(partner?.role)
    const itemizeSalesOrders = isAgentStatement || showOrderItems
    const statementDataForDisplay = useMemo(
        () => statementData ? { ...statementData, itemizeSalesOrders } : null,
        [itemizeSalesOrders, statementData]
    )
    const ledgers = useMemo(
        () => statementDataForDisplay ? buildPartnerAccountStatementLedger(statementDataForDisplay) : [],
        [statementDataForDisplay]
    )
    const printLang = features.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
    const currentTemplatePrintLanguage = resolveCustomTemplatePrintLanguage(printLang)

    useEffect(() => {
        if (!workspaceId || (!isLocalMode && !isSupabaseConfigured)) {
            setCustomTemplates([])
            return
        }

        let cancelled = false
        void fetchCachedCustomTemplates(workspaceId, {
            moduleTypePrefix: 'businessPartners.',
            activeOnly: true
        }).then((templates) => {
            if (!cancelled) setCustomTemplates(templates as StoredCustomTemplateRow[])
        }).catch((error) => {
            console.error('[AccountStatements] Failed to load custom print templates:', error)
            if (!cancelled) setCustomTemplates([])
        })

        return () => {
            cancelled = true
        }
    }, [isLocalMode, workspaceId])

    const workspacePrintContacts = useMemo(() => {
        const primaryContact = (type: 'phone' | 'address' | 'email') => {
            const contacts = workspaceContacts.filter((contact) => contact.type === type && contact.value?.trim())
            return (contacts.find((contact) => contact.isPrimary) || contacts[0])?.value.trim()
        }
        return {
            phone: primaryContact('phone'),
            address: primaryContact('address'),
            email: primaryContact('email')
        }
    }, [workspaceContacts])
    const printData = useMemo<PartnerAccountStatementPrintData | null>(() => {
        if (!partner || !statementDataForDisplay) return null
        return {
            ...statementDataForDisplay,
            workspace: workspacePrintContacts,
            partner: {
                name: partner.name,
                contactName: partner.contactName,
                email: partner.email,
                phone: partner.phone,
                address: partner.address,
                city: partner.city,
                country: partner.country
            },
            generatedAt: new Date().toISOString()
        }
    }, [partner, statementDataForDisplay, workspacePrintContacts])
    const printTarget = useMemo(
        () => getCustomTemplateTarget(PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY),
        []
    )
    const availablePrintTemplates = useMemo(
        () => customTemplates.filter((template) => template.module_type_key === PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY
            && template.active
            && Boolean(readCustomTemplateLayout(template))),
        [customTemplates]
    )
    const selectedPrintLayout = useMemo(
        () => selectedPrintTemplate
            && isCustomTemplatePrintLanguageCompatible(selectedPrintTemplate, currentTemplatePrintLanguage)
            ? readCustomTemplateLayout(selectedPrintTemplate)
            : null,
        [currentTemplatePrintLanguage, selectedPrintTemplate]
    )
    const activePrintLayout = useMemo<CustomTemplateLayout | null>(() => {
        if (selectedPrintLayout) return selectedPrintLayout
        if (!printTarget) return null
        return {
            version: 1,
            label: t('businessPartners.accountStatementA4Template', { defaultValue: 'Partner Account Statement A4' }),
            moduleTypeKey: PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY,
            nativeTemplateKey: printTarget.nativeTemplateKey,
            page: printTarget.page,
            fields: {},
            fieldOrders: {},
            fieldLabelOverrides: {},
            annotations: [],
            texts: [],
            images: [],
            shapes: [],
            updatedAt: new Date().toISOString()
        }
    }, [printTarget, selectedPrintLayout, t])
    const printPreview = useMemo(
        () => printTarget && printData
            ? createCustomTemplatePreview(printTarget, {
                workspaceId,
                workspaceName,
                features,
                partnerAccountStatementData: printData,
                printLang
            })
            : undefined,
        [features, printData, printLang, printTarget, workspaceId, workspaceName]
    )
    const buildPrintPdf = useCallback(async ({ effectiveId }: { format: PrintFormat; effectiveId: string }) => {
        if (!printTarget || !printData || !activePrintLayout) {
            throw new Error('Partner account statement print data is not available.')
        }
        return buildCustomTemplateLayoutPdf({
            target: printTarget,
            layout: activePrintLayout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                partnerAccountStatementData: printData,
                printLang
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [activePrintLayout, features, printData, printLang, printTarget, workspaceId, workspaceName])
    const buildEditablePrintPdf = useCallback(async (
        layout: CustomTemplateLayout,
        printLangOverride?: string,
        effectiveId?: string
    ) => {
        if (!printTarget || !printData) {
            throw new Error('Partner account statement print data is not available.')
        }
        return buildCustomTemplateLayoutPdf({
            target: printTarget,
            layout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                partnerAccountStatementData: printData,
                printLang: printLangOverride || printLang
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [features, printData, printLang, printTarget, workspaceId, workspaceName])
    const customPrintOptions = useMemo(
        () => availablePrintTemplates.map((template) => ({
            format: 'a4' as const,
            template,
            label: getStoredCustomTemplateLabel(template),
            description: t('businessPartners.customAccountStatementA4TemplateDescription', {
                defaultValue: 'Use this saved Partner Account Statement layout.'
            }),
            primary: template.primary,
            disabled: !isCustomTemplatePrintLanguageCompatible(template, currentTemplatePrintLanguage),
            warning: getCustomTemplatePrintLanguageWarning(template, currentTemplatePrintLanguage, t)
        })),
        [availablePrintTemplates, currentTemplatePrintLanguage, t]
    )
    const handlePrintSelection = useCallback((
        _format: PrintFormat,
        template?: StoredCustomTemplateRow,
        nativeTemplateKey?: string
    ) => {
        const requestedKey = template?.module_type_key || nativeTemplateKey
        if (requestedKey !== PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY) return
        if (template && !isCustomTemplatePrintLanguageCompatible(template, currentTemplatePrintLanguage)) return
        setSelectedPrintTemplate(template || null)
    }, [currentTemplatePrintLanguage])
    const selectPartner = useCallback((nextPartner: { id: string; name: string }) => {
        setSelectedPartnerId(nextPartner.id)
        setPartnerQuery(nextPartner.name)
        navigate(`${ACCOUNT_STATEMENT_PATH}?partnerId=${encodeURIComponent(nextPartner.id)}&partnerName=${encodeURIComponent(nextPartner.name)}`)
    }, [navigate])
    const changePartnerQuery = useCallback((value: string) => {
        setPartnerQuery(value)
        if (selectedPartnerId && value !== partner?.name) {
            setSelectedPartnerId(null)
            navigate(ACCOUNT_STATEMENT_PATH)
        }
    }, [navigate, partner?.name, selectedPartnerId])

    useEffect(() => {
        if (partner && selectedPartnerId === partner.id) setPartnerQuery(partner.name)
    }, [partner, selectedPartnerId])

    if (!workspaceId) return null

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <Link href="/business-partners" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" />
                        {t('businessPartners.title', { defaultValue: 'Business Partners' })}
                    </Link>
                    <span>/</span>
                    <span className="truncate font-semibold text-foreground">
                        {t('businessPartners.accountStatement.title', { defaultValue: 'Account Statement' })}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        className="h-10 gap-2 rounded-xl px-4"
                        onClick={() => setIsStatementSettingsOpen(true)}
                    >
                        <Settings className="h-4 w-4" />
                        {t('common.settings')}
                    </Button>
                    <Button
                        variant="outline"
                        className="h-10 gap-2 rounded-xl px-4"
                        disabled={!printPreview || !activePrintLayout}
                        onClick={() => {
                            setSelectedPrintTemplate(null)
                            setIsPrintPreviewOpen(true)
                        }}
                    >
                        <Printer className="h-4 w-4" />
                        {t('common.print', { defaultValue: 'Print' })}
                    </Button>
                </div>
            </div>

            <Card>
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold">
                            {t('businessPartners.title', { defaultValue: 'Business Partner' })}
                        </label>
                        <PartnerAutocompleteInput
                            value={partnerQuery}
                            onChange={changePartnerQuery}
                            onSelectPartner={selectPartner}
                            workspaceId={workspaceId}
                            includeAgentRoles={hasFeature('agent_sales_accounts')}
                            placeholder={t('businessPartners.accountStatement.searchPartner', { defaultValue: 'Search for a business partner' })}
                        />
                    </div>
                    <DateRangeFilters
                        dateRange={dateRange}
                        customDates={customDates}
                        onDateRangeChange={setDateRange}
                        onCustomDatesChange={setCustomDates}
                        className="justify-start lg:justify-end"
                    />
                </CardContent>
            </Card>

            {!selectedPartnerId ? (
                <Card>
                    <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                        <FileText className="mb-4 h-10 w-10 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">
                            {t('businessPartners.accountStatement.selectPartner', { defaultValue: 'Select a business partner' })}
                        </h2>
                        <p className="mt-1 max-w-md text-sm text-muted-foreground">
                            {t('businessPartners.accountStatement.selectPartnerDescription', {
                                defaultValue: 'Choose a partner to view opening balances, account activity, and closing balances.'
                            })}
                        </p>
                    </CardContent>
                </Card>
            ) : !partner ? (
                <Card>
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                        {t('businessPartners.notFoundDescription', { defaultValue: 'The requested record may have been deleted or moved out of this workspace.' })}
                    </CardContent>
                </Card>
            ) : ledgers.length === 0 ? (
                <Card>
                    <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                        <FileText className="mb-4 h-10 w-10 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">{partner.name}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('businessPartners.noActivity', { defaultValue: 'No related activity yet.' })}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <Card className="overflow-hidden">
                        <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <FileText className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h1 className="truncate text-lg font-bold">{partner.name}</h1>
                                <p className="text-sm text-muted-foreground">
                                    {[partner.contactName, partner.phone, partner.address].filter(Boolean).join(' · ')
                                        || t('businessPartners.accountStatement.accountActivity', { defaultValue: 'Account Activity' })}
                                </p>
                            </div>
                            <div className="flex gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> {t('businessPartners.accountStatement.dueFromPartner', { defaultValue: 'Due from partner' })}</span>
                                <span className="inline-flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-amber-600" /> {t('businessPartners.accountStatement.dueToPartner', { defaultValue: 'Due to partner' })}</span>
                            </div>
                        </CardContent>
                    </Card>
                    <div className="space-y-5">
                        {ledgers.map((ledger) => (
                            <LedgerCard
                                key={ledger.currency}
                                ledger={ledger}
                                iqdPreference={features.iqd_display_preference}
                                t={t}
                                i18n={i18n}
                                language={i18n.language}
                                showItemColumns={itemizeSalesOrders}
                                onNavigate={navigate}
                            />
                        ))}
                    </div>
                </>
            )}

            <AppDialog open={isStatementSettingsOpen} onOpenChange={setIsStatementSettingsOpen}>
                <AppDialogContent className="max-w-xl">
                    <AppDialogHeader>
                        <AppDialogTitle>{t('businessPartners.accountStatement.settingsTitle')}</AppDialogTitle>
                    </AppDialogHeader>
                    <AppDialogBody className="space-y-4">
                        <div className="rounded-xl border bg-muted/20 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <label htmlFor="partner-statement-order-item-detail" className="text-sm font-semibold">
                                        {t('businessPartners.accountStatement.showOrderItems')}
                                    </label>
                                    <p className="text-sm text-muted-foreground">
                                        {isAgentStatement
                                            ? t('businessPartners.accountStatement.agentOrderItemsRequired')
                                            : t('businessPartners.accountStatement.showOrderItemsDescription')}
                                    </p>
                                </div>
                                <Switch
                                    id="partner-statement-order-item-detail"
                                    checked={itemizeSalesOrders}
                                    disabled={isAgentStatement}
                                    onCheckedChange={setShowOrderItems}
                                />
                            </div>
                        </div>
                    </AppDialogBody>
                    <AppDialogFooter>
                        <Button type="button" onClick={() => setIsStatementSettingsOpen(false)}>
                            {t('common.close')}
                        </Button>
                    </AppDialogFooter>
                </AppDialogContent>
            </AppDialog>

            {printPreview && printTarget && activePrintLayout && partner && printData ? (
                <PrintPreviewModal
                    isOpen={isPrintPreviewOpen}
                    onClose={() => {
                        setIsPrintPreviewOpen(false)
                        setSelectedPrintTemplate(null)
                    }}
                    onConfirm={() => {
                        setIsPrintPreviewOpen(false)
                        setSelectedPrintTemplate(null)
                    }}
                    title={t('businessPartners.printAccountStatementA4', { defaultValue: 'Print Partner Account Statement A4' })}
                    documentId={partner.id}
                    originId={partner.id}
                    invoiceData={{
                        // `invoices.invoiceid` is limited to 50 characters in
                        // existing workspaces. A UUID is 36 characters, so
                        // keep this stable snapshot identifier below that limit.
                        invoiceid: `PARTNER-STMT-${partner.id}`,
                        totalAmount: partner.netExposure || 0,
                        settlementCurrency: partner.defaultCurrency,
                        origin: 'business_partner',
                        createdBy: user?.id,
                        createdByName: user?.name || 'Unknown',
                        cashierName: user?.name || 'Unknown',
                        printFormat: 'a4'
                    }}
                    pdfBuilder={buildPrintPdf}
                    templatePreview={printPreview}
                    customTemplate={{
                        moduleTypeKey: PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY,
                        nativeTemplateKey: printTarget.nativeTemplateKey,
                        templateId: selectedPrintTemplate?.id,
                        label: selectedPrintTemplate
                            ? getStoredCustomTemplateLabel(selectedPrintTemplate)
                            : t('businessPartners.accountStatementA4Template', { defaultValue: 'Partner Account Statement A4' })
                    }}
                    initialTemplateLayout={activePrintLayout}
                    enableTemplatePreviewSave
                    generateTemplateLayoutBlob={buildEditablePrintPdf}
                    features={features}
                    workspaceName={workspaceName}
                    module="businessPartners"
                    printSelectionOptions={[{
                        format: 'a4',
                        nativeTemplateKey: PARTNER_ACCOUNT_STATEMENT_TEMPLATE_KEY,
                        label: t('businessPartners.accountStatementA4Template', { defaultValue: 'Partner Account Statement A4' }),
                        description: t('businessPartners.accountStatementA4TemplateDescription', {
                            defaultValue: 'Chronological debit, credit, and running balance for each currency.'
                        })
                    }]}
                    printSelectionTemplates={customPrintOptions}
                    onPrintSelection={handlePrintSelection}
                />
            ) : null}
        </div>
    )
}


