import { useRef, useState, type FormEvent, type ComponentType } from 'react'
import { useLocation } from 'wouter'
import { useTranslation } from 'react-i18next'
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    BarChart3,
    Boxes,
    Calculator,
    Check,
    CheckCircle2,
    ClipboardList,
    Database,
    FileText,
    Gauge,
    Info,
    Layers3,
    Package,
    ReceiptText,
    RotateCcw,
    ShoppingCart,
    Sparkles,
    Store,
    Truck,
    Users,
    WalletCards,
    Warehouse
} from 'lucide-react'
import { MONTHLY_USAGE_JOB_TITLES } from '@/data/monthlyUsageJobTitles'
import {
    calculateMonthlyUsage,
    DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN,
    type MonthlyUsageCalculatorInput,
    type MonthlyUsageEstimate,
    type PaymentProfile,
    type ReturnProfile,
    type ReviewFrequency,
    type UploadSizeProfile,
    type UsageActivity,
    type UsageBreakdownKey,
    type UsageFrequency,
    type WorkspaceHistorySize
} from '@/lib/monthlyUsageCalculator'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import { Label } from '@/ui/components/label'
import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher'
import { Switch } from '@/ui/components/switch'
import { ThemeToggle } from '@/ui/components/ThemeToggle'
import { cn } from '@/lib/utils'
import { useFavicon } from '@/hooks/useFavicon'

type CalculatorFormState = MonthlyUsageCalculatorInput & {
    job: string
    industry: string
}

type ActivityField = 'posSales' | 'wholesaleOrders' | 'purchaseOrders' | 'manualLoans'
    | 'loanPayments' | 'savedInvoices' | 'stockOperations' | 'uploads'

type ModuleField = 'usesPos' | 'usesWholesale' | 'usesPurchasing' | 'usesLoans' | 'usesInvoices'

const INITIAL_FORM: CalculatorFormState = {
    job: '',
    industry: 'retail',
    hoursPerDay: 8,
    activeDaysPerWeek: 6,
    teamMembers: 1,
    storageLocations: 1,
    products: 1000,
    historySize: 'fresh',
    batchTracking: false,
    usesPos: true,
    usesWholesale: true,
    usesPurchasing: false,
    usesLoans: true,
    usesInvoices: true,
    averagePosItems: 3,
    averageWholesaleItems: 10,
    averagePurchaseItems: 10,
    posSales: { amount: 50, frequency: 'daily' },
    posPaymentProfile: 'paidNow',
    wholesaleOrders: { amount: 10, frequency: 'weekly' },
    wholesalePaymentProfile: 'mixed',
    purchaseOrders: { amount: 5, frequency: 'weekly' },
    manualLoans: { amount: 5, frequency: 'monthly' },
    loanPayments: { amount: 20, frequency: 'monthly' },
    savedInvoices: { amount: 20, frequency: 'monthly' },
    advancedEnabled: false,
    newOrChangedProductsPerMonth: 20,
    returnProfile: 'few',
    stockOperations: { amount: 5, frequency: 'monthly' },
    historyReviewFrequency: 'occasional',
    reportReviewFrequency: 'occasional',
    uploads: { amount: 0, frequency: 'monthly' },
    uploadSizeProfile: 'medium'
}

const INDUSTRIES = [
    ['retail', 'Retail'],
    ['wholesale', 'Wholesale and distribution'],
    ['food', 'Food and restaurants'],
    ['health', 'Healthcare and pharmacy'],
    ['beauty', 'Beauty and personal care'],
    ['construction', 'Construction and contracting'],
    ['automotive', 'Automotive'],
    ['manufacturing', 'Manufacturing'],
    ['services', 'Professional services'],
    ['realEstate', 'Real estate'],
    ['travel', 'Travel and tourism'],
    ['education', 'Education'],
    ['technology', 'Technology'],
    ['other', 'Other']
] as const

const BREAKDOWN_ICONS: Record<UsageBreakdownKey, ComponentType<{ className?: string }>> = {
    workspace: Gauge,
    catalog: Package,
    pos: ShoppingCart,
    orders: ClipboardList,
    credit: WalletCards,
    invoicesAndFiles: ReceiptText,
    operations: Layers3,
    reports: BarChart3
}

function formatBytes(bytes: number, locale: string): string {
    const safeBytes = Math.max(0, bytes)
    const mib = safeBytes / (1024 * 1024)
    const gib = mib / 1024
    if (gib >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: gib >= 10 ? 1 : 2 }).format(gib)} GB`
    if (mib >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mib >= 10 ? 1 : 2 }).format(mib)} MB`
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(safeBytes / 1024)} KB`
}

function formatCount(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(0, value))
}

function NumberQuestion({
    id,
    label,
    hint,
    value,
    onChange,
    min = 0,
    max,
    step = 1,
    required = true
}: {
    id: string
    label: string
    hint?: string
    value: number
    onChange: (value: number) => void
    min?: number
    max?: number
    step?: number
    required?: boolean
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id} className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</Label>
            {hint && <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
            <Input
                id={id}
                type="number"
                min={min}
                max={max}
                step={step}
                value={value}
                required={required}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-12 bg-white dark:bg-slate-950"
            />
        </div>
    )
}

function ActivityQuestion({
    id,
    label,
    hint,
    value,
    onChange,
    frequencyLabels,
    required = true
}: {
    id: string
    label: string
    hint?: string
    value: UsageActivity
    onChange: (value: UsageActivity) => void
    frequencyLabels: Record<UsageFrequency, string>
    required?: boolean
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={`${id}-amount`} className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</Label>
            {hint && <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(126px,0.75fr)] gap-3">
                <Input
                    id={`${id}-amount`}
                    type="number"
                    min={0}
                    step={1}
                    value={value.amount}
                    required={required}
                    onChange={(event) => onChange({ ...value, amount: Number(event.target.value) })}
                    className="h-12 bg-white dark:bg-slate-950"
                />
                <select
                    id={`${id}-frequency`}
                    value={value.frequency}
                    required={required}
                    onChange={(event) => onChange({ ...value, frequency: event.target.value as UsageFrequency })}
                    className="h-12 w-full rounded-xl border border-input bg-white px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 dark:bg-slate-950"
                >
                    <option value="daily">{frequencyLabels.daily}</option>
                    <option value="weekly">{frequencyLabels.weekly}</option>
                    <option value="monthly">{frequencyLabels.monthly}</option>
                </select>
            </div>
        </div>
    )
}

function ChoiceGroup<T extends string>({
    label,
    hint,
    value,
    options,
    onChange,
    columns = 3
}: {
    label: string
    hint?: string
    value: T
    options: Array<{ value: T; label: string; description?: string }>
    onChange: (value: T) => void
    columns?: 2 | 3 | 4
}) {
    return (
        <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</legend>
            {hint && <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
            <div className={cn(
                'grid gap-2 pt-1',
                columns === 2 && 'sm:grid-cols-2',
                columns === 3 && 'sm:grid-cols-3',
                columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4'
            )}>
                {options.map((option) => {
                    const selected = option.value === value
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onChange(option.value)}
                            className={cn(
                                'relative min-h-14 rounded-xl border px-3 py-2.5 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                                selected
                                    ? 'border-teal-500 bg-teal-50 text-teal-950 ring-1 ring-teal-500/20 dark:bg-teal-950/50 dark:text-teal-50'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                            )}
                        >
                            <span className="flex items-center justify-between gap-2">
                                <span className="text-sm font-bold">{option.label}</span>
                                {selected && <Check className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />}
                            </span>
                            {option.description && <span className="mt-1 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{option.description}</span>}
                        </button>
                    )
                })}
            </div>
        </fieldset>
    )
}

function StepTitle({ icon: Icon, eyebrow, title, description }: {
    icon: ComponentType<{ className?: string }>
    eyebrow: string
    title: string
    description: string
}) {
    return (
        <div className="mb-7 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                <Icon className="h-6 w-6" />
            </div>
            <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-300">{eyebrow}</div>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
            </div>
        </div>
    )
}

function WorkflowCard({ icon: Icon, title, description, children }: {
    icon: ComponentType<{ className?: string }>
    title: string
    description: string
    children: React.ReactNode
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-950/45">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300">
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
                </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">{children}</div>
        </section>
    )
}

export function MonthlyUsageCalculator() {
    const [, setLocation] = useLocation()
    const { t, i18n } = useTranslation()
    const scrollRef = useRef<HTMLDivElement>(null)
    const formRef = useRef<HTMLFormElement>(null)
    const [form, setForm] = useState<CalculatorFormState>(INITIAL_FORM)
    const [currentStep, setCurrentStep] = useState(0)
    const [estimate, setEstimate] = useState<MonthlyUsageEstimate | null>(null)
    useFavicon()

    const locale = i18n.language || 'en'
    const frequencyLabels: Record<UsageFrequency, string> = {
        daily: t('monthlyUsageCalculator.frequency.daily', { defaultValue: 'Per day' }),
        weekly: t('monthlyUsageCalculator.frequency.weekly', { defaultValue: 'Per week' }),
        monthly: t('monthlyUsageCalculator.frequency.monthly', { defaultValue: 'Per month' })
    }

    const steps = [
        { label: t('monthlyUsageCalculator.steps.profile', { defaultValue: 'About you' }), icon: Users },
        { label: t('monthlyUsageCalculator.steps.startingPoint', { defaultValue: 'Starting point' }), icon: Warehouse },
        { label: t('monthlyUsageCalculator.steps.workflows', { defaultValue: 'What you use' }), icon: Boxes },
        { label: t('monthlyUsageCalculator.steps.accuracy', { defaultValue: 'Improve accuracy' }), icon: Sparkles }
    ]

    const updateActivity = (field: ActivityField, value: UsageActivity) => {
        setForm((current) => ({ ...current, [field]: value }))
    }

    const updateModule = (field: ModuleField) => {
        setForm((current) => ({ ...current, [field]: !current[field] }))
    }

    const scrollTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

    const nextStep = () => {
        if (!formRef.current?.reportValidity()) return
        setCurrentStep((step) => Math.min(3, step + 1))
        scrollTop()
    }

    const previousStep = () => {
        setCurrentStep((step) => Math.max(0, step - 1))
        scrollTop()
    }

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setEstimate(calculateMonthlyUsage(form))
        scrollTop()
    }

    const editAnswers = () => {
        setEstimate(null)
        setCurrentStep(0)
        scrollTop()
    }

    const enabledModuleLabels = [
        form.usesPos && t('monthlyUsageCalculator.modules.pos', { defaultValue: 'POS' }),
        form.usesWholesale && t('monthlyUsageCalculator.modules.wholesale', { defaultValue: 'Wholesale' }),
        form.usesPurchasing && t('monthlyUsageCalculator.modules.purchasing', { defaultValue: 'Purchasing' }),
        form.usesLoans && t('monthlyUsageCalculator.modules.loans', { defaultValue: 'Loans' }),
        form.usesInvoices && t('monthlyUsageCalculator.modules.invoices', { defaultValue: 'Invoices' })
    ].filter(Boolean) as string[]

    const planLimit = estimate?.recommendedPlan.limitBytes ?? null
    const recommendationPercent = estimate && planLimit
        ? Math.min(100, estimate.recommendedUsageBytes / planLimit * 100)
        : 0

    const historyOptions: Array<{ value: WorkspaceHistorySize; label: string; description: string }> = [
        { value: 'fresh', label: t('monthlyUsageCalculator.history.fresh', { defaultValue: 'Starting fresh' }), description: t('monthlyUsageCalculator.history.freshDescription', { defaultValue: 'No previous business records' }) },
        { value: 'small', label: t('monthlyUsageCalculator.history.small', { defaultValue: 'Up to 1,000' }), description: t('monthlyUsageCalculator.history.smallDescription', { defaultValue: 'A small existing history' }) },
        { value: 'medium', label: t('monthlyUsageCalculator.history.medium', { defaultValue: '1,000–10,000' }), description: t('monthlyUsageCalculator.history.mediumDescription', { defaultValue: 'An established workspace' }) },
        { value: 'large', label: t('monthlyUsageCalculator.history.large', { defaultValue: 'More than 10,000' }), description: t('monthlyUsageCalculator.history.largeDescription', { defaultValue: 'A large existing history' }) }
    ]

    const paymentOptions: Array<{ value: PaymentProfile; label: string; description: string }> = [
        { value: 'paidNow', label: t('monthlyUsageCalculator.payment.paidNow', { defaultValue: 'Paid now' }), description: t('monthlyUsageCalculator.payment.paidNowDescription', { defaultValue: 'Mostly completed immediately' }) },
        { value: 'mixed', label: t('monthlyUsageCalculator.payment.mixed', { defaultValue: 'A mix' }), description: t('monthlyUsageCalculator.payment.mixedDescription', { defaultValue: 'Cash and pay-later sales' }) },
        { value: 'oftenLater', label: t('monthlyUsageCalculator.payment.oftenLater', { defaultValue: 'Often paid later' }), description: t('monthlyUsageCalculator.payment.oftenLaterDescription', { defaultValue: 'Loans or installments are common' }) }
    ]

    const reviewOptions: Array<{ value: ReviewFrequency; label: string }> = [
        { value: 'occasional', label: t('monthlyUsageCalculator.review.occasional', { defaultValue: 'Occasionally' }) },
        { value: 'daily', label: t('monthlyUsageCalculator.review.daily', { defaultValue: 'Daily' }) },
        { value: 'frequent', label: t('monthlyUsageCalculator.review.frequent', { defaultValue: 'Several times a day' }) }
    ]

    if (estimate) {
        const activeGeneratedRecords = estimate.generatedRecords.filter((item) => item.count > 0)
        return (
            <div ref={scrollRef} className="h-screen min-h-0 overflow-y-auto overscroll-contain bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
                <CalculatorHeader onBack={() => setLocation('/login')} t={t} />
                <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
                    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-bold text-teal-700 dark:text-teal-300">{t('monthlyUsageCalculator.results.complete', { defaultValue: 'Estimate complete' })}</div>
                            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{t('monthlyUsageCalculator.results.title', { defaultValue: 'Your monthly usage estimate' })}</h1>
                        </div>
                        <Button type="button" variant="outline" onClick={editAnswers} className="h-11 rounded-xl">
                            <RotateCcw className="h-4 w-4" />
                            {t('monthlyUsageCalculator.results.edit', { defaultValue: 'Edit answers' })}
                        </Button>
                    </div>

                    <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-teal-800 via-teal-600 to-emerald-500 p-6 text-white shadow-2xl shadow-teal-900/20 sm:p-8">
                        <div className="grid gap-7 lg:grid-cols-[1.3fr_1fr] lg:items-end">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-bold text-teal-50">
                                    <Calculator className="h-4 w-4" />
                                    {t('monthlyUsageCalculator.results.typicalLabel', { defaultValue: 'Most likely monthly usage' })}
                                </div>
                                <div className="mt-4 text-5xl font-black tracking-tight sm:text-6xl">{formatBytes(estimate.typicalMonthBytes, locale)}</div>
                                <p className="mt-3 max-w-xl text-sm leading-6 text-teal-50/90">
                                    {t('monthlyUsageCalculator.results.range', {
                                        defaultValue: 'Expected range: {{low}} to {{high}} depending on activity.',
                                        low: formatBytes(estimate.lowMonthBytes, locale),
                                        high: formatBytes(estimate.busyMonthBytes, locale)
                                    })}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <ResultMiniMetric label={t('monthlyUsageCalculator.results.firstMonth', { defaultValue: 'First month' })} value={formatBytes(estimate.firstMonthBytes, locale)} />
                                <ResultMiniMetric label={t('monthlyUsageCalculator.results.workdayAverage', { defaultValue: 'Workday average' })} value={formatBytes(estimate.averageWorkingDayBytes, locale)} />
                                <ResultMiniMetric label={t('monthlyUsageCalculator.results.uploaded', { defaultValue: 'Uploaded' })} value={formatBytes(estimate.uploadedBytes, locale)} />
                                <ResultMiniMetric label={t('monthlyUsageCalculator.results.downloaded', { defaultValue: 'Downloaded' })} value={formatBytes(estimate.downloadedBytes, locale)} />
                            </div>
                        </div>
                    </section>

                    <div className="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
                        <div className="space-y-7">
                            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-lg font-black">{t('monthlyUsageCalculator.results.breakdown', { defaultValue: 'Where the usage comes from' })}</h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.results.breakdownDescription', { defaultValue: 'Every category includes its related requests, responses, and follow-up synchronization.' })}</p>
                                    </div>
                                    <Database className="h-6 w-6 text-teal-600" />
                                </div>
                                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                                    {estimate.breakdown.filter((item) => item.bytes > 0).map((item) => {
                                        const Icon = BREAKDOWN_ICONS[item.key]
                                        const percent = estimate.typicalMonthBytes > 0 ? item.bytes / estimate.typicalMonthBytes * 100 : 0
                                        return (
                                            <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300"><Icon className="h-4 w-4" /></div>
                                                        <span className="text-sm font-bold">{t(`monthlyUsageCalculator.breakdown.${item.key}`, { defaultValue: item.key })}</span>
                                                    </div>
                                                    <span className="text-sm font-black">{formatBytes(item.bytes, locale)}</span>
                                                </div>
                                                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.max(1, percent)}%` }} /></div>
                                                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                                                    <span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" />{formatBytes(item.uploadedBytes, locale)}</span>
                                                    <span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" />{formatBytes(item.downloadedBytes, locale)}</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </section>

                            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Layers3 className="h-5 w-5" /></div>
                                    <div>
                                        <h2 className="text-lg font-black">{t('monthlyUsageCalculator.results.generatedTitle', { defaultValue: 'Records and dependent work included' })}</h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.results.generatedDescription', { defaultValue: 'These are calculated automatically from your simple answers.' })}</p>
                                    </div>
                                </div>
                                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                    {activeGeneratedRecords.map((item) => (
                                        <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950">
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t(`monthlyUsageCalculator.generated.${item.key}`, { defaultValue: item.key })}</span>
                                            <strong className="text-sm">{formatCount(item.count, locale)}</strong>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <details className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm open:shadow-md sm:p-6 dark:border-slate-800 dark:bg-slate-900">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <Info className="h-5 w-5 text-teal-600" />
                                        <div>
                                            <h2 className="font-black">{t('monthlyUsageCalculator.results.assumptions', { defaultValue: 'Assumptions used' })}</h2>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.results.assumptionsHint', { defaultValue: 'Open to see how dependencies were handled.' })}</p>
                                        </div>
                                    </div>
                                    <ArrowDown className="h-4 w-4 transition group-open:rotate-180" />
                                </summary>
                                <ul className="mt-5 space-y-3 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:text-slate-300">
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.loanSchedule', { defaultValue: 'Each new loan includes {{count}} generated schedule rows; every loan payment updates that full schedule.', count: DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN })} />
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.partners', { defaultValue: 'Wholesale orders and linked loans reuse existing business partners and include their summary updates; no new partner is assumed per transaction.' })} />
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.pos', { defaultValue: 'POS includes the checkout RPC, sale-item children, later history sync, and full batch refreshes when batch tracking is enabled.' })} />
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.orders', { defaultValue: 'Order product lines are embedded in the order payload; product, payment, and partner updates are included separately.' })} />
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.invoices', { defaultValue: 'A saved invoice PDF is estimated at 300 KB and counted twice on upload for its version and latest copy.' })} />
                                    <Assumption text={t('monthlyUsageCalculator.assumptions.firstSync', { defaultValue: 'First month includes one initial local cache and history sync for each regular workspace user.' })} />
                                    {!form.advancedEnabled && <Assumption text={t('monthlyUsageCalculator.assumptions.standardAdvanced', { defaultValue: 'With optional questions off, the estimate uses occasional history/report reviews, a small return rate, and normal product changes.' })} />}
                                </ul>
                            </details>
                        </div>

                        <aside className="space-y-5 lg:sticky lg:top-6">
                            <section className="rounded-3xl border border-teal-200 bg-teal-50 p-5 shadow-sm dark:border-teal-900 dark:bg-teal-950/45">
                                <div className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-300">{t('monthlyUsageCalculator.results.recommendedPlan', { defaultValue: 'Recommended allowance' })}</div>
                                <div className="mt-2 flex items-end justify-between gap-3">
                                    <div className="text-2xl font-black text-teal-950 dark:text-teal-50">{t(`monthlyUsageCalculator.plans.${estimate.recommendedPlan.id}`, { defaultValue: estimate.recommendedPlan.id })}</div>
                                    <div className="font-bold text-teal-700 dark:text-teal-300">{planLimit ? formatBytes(planLimit, locale) : t('monthlyUsageCalculator.plans.unlimited', { defaultValue: 'Unlimited' })}</div>
                                </div>
                                {planLimit && <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-teal-200 dark:bg-teal-900"><div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(2, recommendationPercent)}%` }} /></div>}
                                <p className="mt-4 text-xs leading-5 text-teal-800 dark:text-teal-200">{t('monthlyUsageCalculator.results.headroom', { defaultValue: 'Based on the larger first or busy month, plus 20% room for growth.' })}</p>
                                <div className="mt-4 rounded-xl bg-white/70 px-3 py-2.5 text-xs text-teal-900 dark:bg-slate-950/50 dark:text-teal-100">
                                    {t('monthlyUsageCalculator.results.planningAmount', { defaultValue: 'Planning amount: {{value}}', value: formatBytes(estimate.recommendedUsageBytes, locale) })}
                                </div>
                            </section>

                            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <h3 className="font-black">{t('monthlyUsageCalculator.results.monthlyActivity', { defaultValue: 'Normalized monthly activity' })}</h3>
                                <div className="mt-4 space-y-2.5">
                                    {Object.entries(estimate.monthlyOccurrences).filter(([, value]) => value > 0).map(([key, value]) => (
                                        <div key={key} className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-slate-500 dark:text-slate-400">{t(`monthlyUsageCalculator.occurrences.${key}`, { defaultValue: key })}</span>
                                            <strong>{formatCount(value, locale)}</strong>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <div className="flex items-start gap-2 rounded-2xl bg-slate-100 p-4 text-xs leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                                {t('monthlyUsageCalculator.results.disclaimer', { defaultValue: 'This is a planning estimate based on Atlas workflow payloads. Actual transfer varies with record detail, caching, files, and working habits.' })}
                            </div>
                        </aside>
                    </div>
                </main>
            </div>
        )
    }

    return (
        <div ref={scrollRef} className="h-screen min-h-0 overflow-y-auto overscroll-contain bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
            <CalculatorHeader onBack={() => setLocation('/login')} t={t} />
            <main className="mx-auto max-w-[1200px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
                <div className="mb-8 max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-300"><Sparkles className="h-3.5 w-3.5" />{t('monthlyUsageCalculator.eyebrow', { defaultValue: 'A clearer workspace estimate' })}</div>
                    <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{t('monthlyUsageCalculator.title', { defaultValue: 'Monthly Usage Calculator' })}</h1>
                    <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{t('monthlyUsageCalculator.subtitleRemake', { defaultValue: 'Four short steps estimate your real Atlas workflows—including generated records and follow-up synchronization.' })}</p>
                </div>

                <nav aria-label={t('monthlyUsageCalculator.steps.label', { defaultValue: 'Calculator progress' })} className="mb-6 grid grid-cols-4 gap-2">
                    {steps.map((step, index) => {
                        const Icon = step.icon
                        const active = index === currentStep
                        const complete = index < currentStep
                        return (
                            <button
                                key={step.label}
                                type="button"
                                disabled={index > currentStep}
                                onClick={() => { if (index <= currentStep) { setCurrentStep(index); scrollTop() } }}
                                className={cn(
                                    'rounded-2xl border px-2 py-3 text-center transition sm:flex sm:items-center sm:gap-3 sm:px-4 sm:text-start',
                                    active && 'border-teal-500 bg-teal-50 text-teal-950 shadow-sm dark:bg-teal-950/50 dark:text-teal-50',
                                    complete && 'border-teal-200 bg-white text-teal-700 dark:border-teal-900 dark:bg-slate-900 dark:text-teal-300',
                                    !active && !complete && 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900',
                                    index > currentStep && 'cursor-default'
                                )}
                            >
                                <span className="mx-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm sm:mx-0 dark:bg-slate-950">{complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}</span>
                                <span className="mt-1 hidden text-xs font-bold sm:mt-0 sm:block lg:text-sm">{step.label}</span>
                            </button>
                        )
                    })}
                </nav>

                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
                    <form ref={formRef} onSubmit={handleSubmit} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
                        <div className="p-5 sm:p-7">
                            {currentStep === 0 && (
                                <>
                                    <StepTitle icon={Users} eyebrow={t('monthlyUsageCalculator.steps.step', { defaultValue: 'Step 1 of 4' })} title={t('monthlyUsageCalculator.sections.business', { defaultValue: 'About your business' })} description={t('monthlyUsageCalculator.sections.businessRemakeDescription', { defaultValue: 'Your role is survey context. The working schedule and team size shape recurring reads and synchronization.' })} />
                                    <div className="grid gap-5 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="usage-job" className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('monthlyUsageCalculator.questions.job', { defaultValue: 'What is your job or role?' })}</Label>
                                            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.questions.jobHint', { defaultValue: 'Start typing to search, or enter your own job title.' })}</p>
                                            <Input id="usage-job" list="monthly-usage-job-options" value={form.job} required autoComplete="organization-title" placeholder={t('monthlyUsageCalculator.questions.jobPlaceholder', { defaultValue: 'e.g. Store owner' })} onChange={(event) => setForm((current) => ({ ...current, job: event.target.value }))} className="h-12 bg-white dark:bg-slate-950" />
                                            <datalist id="monthly-usage-job-options">{MONTHLY_USAGE_JOB_TITLES.map((job) => <option key={job} value={job} />)}</datalist>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="usage-industry" className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('monthlyUsageCalculator.questions.industry', { defaultValue: 'What type of business is it?' })}</Label>
                                            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.questions.industryHint', { defaultValue: 'Choose the closest match.' })}</p>
                                            <select id="usage-industry" value={form.industry} required onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} className="h-12 w-full rounded-xl border border-input bg-white px-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 dark:bg-slate-950">
                                                {INDUSTRIES.map(([value, label]) => <option key={value} value={value}>{t(`monthlyUsageCalculator.industries.${value}`, { defaultValue: label })}</option>)}
                                            </select>
                                        </div>
                                        <NumberQuestion id="usage-hours" label={t('monthlyUsageCalculator.questions.hours', { defaultValue: 'Hours using Atlas per working day' })} value={form.hoursPerDay} min={0.5} max={24} step={0.5} onChange={(hoursPerDay) => setForm((current) => ({ ...current, hoursPerDay }))} />
                                        <NumberQuestion id="usage-days" label={t('monthlyUsageCalculator.questions.days', { defaultValue: 'Active business days per week' })} value={form.activeDaysPerWeek} min={1} max={7} onChange={(activeDaysPerWeek) => setForm((current) => ({ ...current, activeDaysPerWeek }))} />
                                        <NumberQuestion id="usage-members" label={t('monthlyUsageCalculator.questions.members', { defaultValue: 'People who regularly use the workspace' })} hint={t('monthlyUsageCalculator.questions.membersHint', { defaultValue: 'Used to estimate local caches and recurring workspace reads.' })} value={form.teamMembers} min={1} max={10000} onChange={(teamMembers) => setForm((current) => ({ ...current, teamMembers }))} />
                                    </div>
                                </>
                            )}

                            {currentStep === 1 && (
                                <>
                                    <StepTitle icon={Warehouse} eyebrow={t('monthlyUsageCalculator.steps.step2', { defaultValue: 'Step 2 of 4' })} title={t('monthlyUsageCalculator.sections.startingPoint', { defaultValue: 'Products and starting point' })} description={t('monthlyUsageCalculator.sections.startingPointDescription', { defaultValue: 'This captures catalog synchronization, initial setup, and existing history without asking technical database questions.' })} />
                                    <div className="grid gap-5 md:grid-cols-2">
                                        <NumberQuestion id="usage-storages" label={t('monthlyUsageCalculator.questions.storages', { defaultValue: 'Real-life storage locations' })} hint={t('monthlyUsageCalculator.questions.storagesHint', { defaultValue: 'Include shops, warehouses, branches, and stock rooms.' })} value={form.storageLocations} min={1} onChange={(storageLocations) => setForm((current) => ({ ...current, storageLocations }))} />
                                        <NumberQuestion id="usage-products" label={t('monthlyUsageCalculator.questions.products', { defaultValue: 'Unique products or SKUs' })} hint={t('monthlyUsageCalculator.questions.productsHint', { defaultValue: 'Count product types, not every physical unit.' })} value={form.products} min={0} onChange={(products) => setForm((current) => ({ ...current, products }))} />
                                    </div>
                                    <div className="mt-6 space-y-6">
                                        <ChoiceGroup label={t('monthlyUsageCalculator.questions.historySize', { defaultValue: 'Are you starting fresh or bringing existing records?' })} hint={t('monthlyUsageCalculator.questions.historySizeHint', { defaultValue: 'Estimate the combined past sales, orders, loans, and invoices already in the workspace.' })} value={form.historySize} options={historyOptions} columns={4} onChange={(historySize) => setForm((current) => ({ ...current, historySize }))} />
                                        <div className="flex items-start justify-between gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                                            <div className="flex gap-3">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300"><Layers3 className="h-4 w-4" /></div>
                                                <div><Label htmlFor="usage-batches" className="text-sm font-bold">{t('monthlyUsageCalculator.questions.batchTracking', { defaultValue: 'Do you track batches or expiry dates?' })}</Label><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.questions.batchTrackingHint', { defaultValue: 'Atlas refreshes batch information after stock-changing workflows, so this can materially affect usage.' })}</p></div>
                                            </div>
                                            <Switch id="usage-batches" checked={form.batchTracking} onCheckedChange={(batchTracking) => setForm((current) => ({ ...current, batchTracking }))} />
                                        </div>
                                    </div>
                                </>
                            )}

                            {currentStep === 2 && (
                                <>
                                    <StepTitle icon={Boxes} eyebrow={t('monthlyUsageCalculator.steps.step3', { defaultValue: 'Step 3 of 4' })} title={t('monthlyUsageCalculator.sections.workflows', { defaultValue: 'What will you use?' })} description={t('monthlyUsageCalculator.sections.workflowsDescription', { defaultValue: 'Select only the workflows you need. Each one reveals a few plain-language questions.' })} />
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                                        {([
                                            ['usesPos', ShoppingCart, t('monthlyUsageCalculator.modules.pos', { defaultValue: 'POS' })],
                                            ['usesWholesale', Store, t('monthlyUsageCalculator.modules.wholesale', { defaultValue: 'Wholesale' })],
                                            ['usesPurchasing', Truck, t('monthlyUsageCalculator.modules.purchasing', { defaultValue: 'Purchasing' })],
                                            ['usesLoans', WalletCards, t('monthlyUsageCalculator.modules.loans', { defaultValue: 'Loans' })],
                                            ['usesInvoices', ReceiptText, t('monthlyUsageCalculator.modules.invoices', { defaultValue: 'Invoices' })]
                                        ] as Array<[ModuleField, ComponentType<{ className?: string }>, string]>).map(([field, Icon, label]) => {
                                            const selected = form[field]
                                            return <button key={field} type="button" aria-pressed={selected} onClick={() => updateModule(field)} className={cn('relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-bold transition', selected ? 'border-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-50' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400')}><Icon className="h-5 w-5" />{label}{selected && <span className="absolute end-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-teal-600 text-white"><Check className="h-3 w-3" /></span>}</button>
                                        })}
                                    </div>
                                    <div className="mt-6 space-y-4">
                                        {form.usesPos && <WorkflowCard icon={ShoppingCart} title={t('monthlyUsageCalculator.workflows.posTitle', { defaultValue: 'Single sales (POS)' })} description={t('monthlyUsageCalculator.workflows.posDescription', { defaultValue: 'Includes sale items, later history synchronization, and inventory/batch effects.' })}><ActivityQuestion id="usage-pos" label={t('monthlyUsageCalculator.questions.posSales', { defaultValue: 'How many single sales?' })} value={form.posSales} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('posSales', value)} /><NumberQuestion id="usage-pos-items" label={t('monthlyUsageCalculator.questions.posItems', { defaultValue: 'Different products in a typical sale' })} value={form.averagePosItems} min={1} onChange={(averagePosItems) => setForm((current) => ({ ...current, averagePosItems }))} /><div className="md:col-span-2"><ChoiceGroup label={t('monthlyUsageCalculator.questions.posPayment', { defaultValue: 'How are counter sales usually paid?' })} value={form.posPaymentProfile} options={paymentOptions} onChange={(posPaymentProfile) => setForm((current) => ({ ...current, posPaymentProfile }))} /></div></WorkflowCard>}
                                        {form.usesWholesale && <WorkflowCard icon={Store} title={t('monthlyUsageCalculator.workflows.wholesaleTitle', { defaultValue: 'Wholesale sales (Sale Orders)' })} description={t('monthlyUsageCalculator.workflows.wholesaleDescription', { defaultValue: 'Includes embedded order lines, inventory changes, payments, and partner summary updates.' })}><ActivityQuestion id="usage-wholesale" label={t('monthlyUsageCalculator.questions.wholesaleOrders', { defaultValue: 'How many wholesale orders?' })} value={form.wholesaleOrders} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('wholesaleOrders', value)} /><NumberQuestion id="usage-wholesale-items" label={t('monthlyUsageCalculator.questions.wholesaleItems', { defaultValue: 'Different products in a typical order' })} value={form.averageWholesaleItems} min={1} onChange={(averageWholesaleItems) => setForm((current) => ({ ...current, averageWholesaleItems }))} /><div className="md:col-span-2"><ChoiceGroup label={t('monthlyUsageCalculator.questions.wholesalePayment', { defaultValue: 'How are wholesale orders usually paid?' })} value={form.wholesalePaymentProfile} options={paymentOptions} onChange={(wholesalePaymentProfile) => setForm((current) => ({ ...current, wholesalePaymentProfile }))} /></div></WorkflowCard>}
                                        {form.usesPurchasing && <WorkflowCard icon={Truck} title={t('monthlyUsageCalculator.workflows.purchasingTitle', { defaultValue: 'Purchase Orders' })} description={t('monthlyUsageCalculator.workflows.purchasingDescription', { defaultValue: 'Includes embedded product lines, inventory receipt, supplier summaries, and payments.' })}><ActivityQuestion id="usage-purchases" label={t('monthlyUsageCalculator.questions.purchaseOrders', { defaultValue: 'How many purchase orders?' })} value={form.purchaseOrders} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('purchaseOrders', value)} /><NumberQuestion id="usage-purchase-items" label={t('monthlyUsageCalculator.questions.purchaseItems', { defaultValue: 'Different products in a typical purchase order' })} value={form.averagePurchaseItems} min={1} onChange={(averagePurchaseItems) => setForm((current) => ({ ...current, averagePurchaseItems }))} /></WorkflowCard>}
                                        {form.usesLoans && <WorkflowCard icon={WalletCards} title={t('monthlyUsageCalculator.workflows.loansTitle', { defaultValue: 'Loans and payments' })} description={t('monthlyUsageCalculator.workflows.loansDescription', { defaultValue: 'Count separate loans here. Pay-later POS and wholesale loans are inferred from the payment choices above.' })}><ActivityQuestion id="usage-loans" label={t('monthlyUsageCalculator.questions.manualLoans', { defaultValue: 'Loans created separately in the Loans section' })} value={form.manualLoans} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('manualLoans', value)} /><ActivityQuestion id="usage-loan-payments" label={t('monthlyUsageCalculator.questions.loanPayments', { defaultValue: 'Payments recorded toward loans or installments' })} value={form.loanPayments} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('loanPayments', value)} /></WorkflowCard>}
                                        {form.usesInvoices && <WorkflowCard icon={ReceiptText} title={t('monthlyUsageCalculator.workflows.invoicesTitle', { defaultValue: 'Saved invoice PDFs' })} description={t('monthlyUsageCalculator.workflows.invoicesDescription', { defaultValue: 'Count PDFs saved or printed into Atlas. Do not count a receipt merely shown after checkout.' })}><ActivityQuestion id="usage-invoices" label={t('monthlyUsageCalculator.questions.savedInvoices', { defaultValue: 'Invoices saved or printed separately' })} value={form.savedInvoices} frequencyLabels={frequencyLabels} onChange={(value) => updateActivity('savedInvoices', value)} /><div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t('monthlyUsageCalculator.questions.savedInvoicesHint', { defaultValue: 'Atlas stores an immutable version and a latest copy, so each saved PDF is included twice on upload.' })}</div></WorkflowCard>}
                                        {enabledModuleLabels.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{t('monthlyUsageCalculator.workflows.none', { defaultValue: 'No transaction workflows selected. The estimate will cover workspace and catalog synchronization only.' })}</div>}
                                    </div>
                                </>
                            )}

                            {currentStep === 3 && (
                                <>
                                    <StepTitle icon={Sparkles} eyebrow={t('monthlyUsageCalculator.steps.step4', { defaultValue: 'Step 4 of 4' })} title={t('monthlyUsageCalculator.sections.advanced', { defaultValue: 'Improve accuracy (optional)' })} description={t('monthlyUsageCalculator.sections.advancedRemakeDescription', { defaultValue: 'Turn this on only if you know these details. The calculator uses clear standard assumptions when it is off.' })} />
                                    <div className={cn('flex items-start justify-between gap-5 rounded-2xl border p-4 transition', form.advancedEnabled ? 'border-teal-400 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50')}>
                                        <div><Label htmlFor="usage-advanced" className="font-bold">{t('monthlyUsageCalculator.sections.useAdvanced', { defaultValue: 'Use my detailed answers' })}</Label><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.sections.useAdvancedHint', { defaultValue: 'Everything below remains optional and is ignored while this is off.' })}</p></div>
                                        <Switch id="usage-advanced" checked={form.advancedEnabled} onCheckedChange={(advancedEnabled) => setForm((current) => ({ ...current, advancedEnabled }))} />
                                    </div>
                                    {!form.advancedEnabled ? (
                                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                            {[t('monthlyUsageCalculator.standard.productChanges', { defaultValue: 'Normal monthly product changes' }), t('monthlyUsageCalculator.standard.returns', { defaultValue: 'About 1% of POS sales returned' }), t('monthlyUsageCalculator.standard.reviews', { defaultValue: 'Occasional history and report reviews' }), t('monthlyUsageCalculator.standard.noFiles', { defaultValue: 'No additional file uploads' })].map((text) => <div key={text} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300"><CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" />{text}</div>)}
                                        </div>
                                    ) : (
                                        <div className="mt-6 space-y-6">
                                            <div className="grid gap-5 md:grid-cols-2">
                                                <NumberQuestion id="usage-product-changes" label={t('monthlyUsageCalculator.questions.productChanges', { defaultValue: 'New or changed products per month' })} value={form.newOrChangedProductsPerMonth} min={0} required={false} onChange={(newOrChangedProductsPerMonth) => setForm((current) => ({ ...current, newOrChangedProductsPerMonth }))} />
                                                <ActivityQuestion id="usage-stock-operations" label={t('monthlyUsageCalculator.questions.stockOperations', { defaultValue: 'Stock moves or adjustments' })} value={form.stockOperations} frequencyLabels={frequencyLabels} required={false} onChange={(value) => updateActivity('stockOperations', value)} />
                                            </div>
                                            {form.usesPos && <ChoiceGroup label={t('monthlyUsageCalculator.questions.returnProfile', { defaultValue: 'How often are POS sales returned or refunded?' })} value={form.returnProfile} columns={4} options={([
                                                ['none', t('monthlyUsageCalculator.returns.none', { defaultValue: 'Almost never' })],
                                                ['few', t('monthlyUsageCalculator.returns.few', { defaultValue: 'A few' })],
                                                ['some', t('monthlyUsageCalculator.returns.some', { defaultValue: 'Sometimes' })],
                                                ['many', t('monthlyUsageCalculator.returns.many', { defaultValue: 'Often' })]
                                            ] as Array<[ReturnProfile, string]>).map(([value, label]) => ({ value, label }))} onChange={(returnProfile) => setForm((current) => ({ ...current, returnProfile }))} />}
                                            <div className="grid gap-6 md:grid-cols-2">
                                                <ChoiceGroup label={t('monthlyUsageCalculator.questions.historyReviews', { defaultValue: 'How often do you review past sales?' })} value={form.historyReviewFrequency} options={reviewOptions} onChange={(historyReviewFrequency) => setForm((current) => ({ ...current, historyReviewFrequency }))} />
                                                <ChoiceGroup label={t('monthlyUsageCalculator.questions.reportReviews', { defaultValue: 'How often do you open dashboards or reports?' })} value={form.reportReviewFrequency} options={reviewOptions} onChange={(reportReviewFrequency) => setForm((current) => ({ ...current, reportReviewFrequency }))} />
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                                                <div className="grid gap-5 md:grid-cols-2"><ActivityQuestion id="usage-uploads" label={t('monthlyUsageCalculator.questions.uploadsRemake', { defaultValue: 'Product images, PDFs, or other files uploaded' })} value={form.uploads} frequencyLabels={frequencyLabels} required={false} onChange={(value) => updateActivity('uploads', value)} /><ChoiceGroup label={t('monthlyUsageCalculator.questions.uploadSizeBand', { defaultValue: 'Typical file size' })} value={form.uploadSizeProfile} options={([
                                                    ['small', t('monthlyUsageCalculator.fileSizes.small', { defaultValue: 'Small' }), '~0.5 MB'],
                                                    ['medium', t('monthlyUsageCalculator.fileSizes.medium', { defaultValue: 'Medium' }), '~2 MB'],
                                                    ['large', t('monthlyUsageCalculator.fileSizes.large', { defaultValue: 'Large' }), '~5 MB']
                                                ] as Array<[UploadSizeProfile, string, string]>).map(([value, label, description]) => ({ value, label, description }))} onChange={(uploadSizeProfile) => setForm((current) => ({ ...current, uploadSizeProfile }))} /></div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7 dark:border-slate-800 dark:bg-slate-950/60">
                            <Button type="button" variant="ghost" onClick={previousStep} disabled={currentStep === 0} className="h-11 rounded-xl"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('monthlyUsageCalculator.navigation.back', { defaultValue: 'Back' })}</Button>
                            {currentStep < 3 ? <Button type="button" onClick={nextStep} className="h-11 rounded-xl bg-teal-600 px-6 text-white hover:bg-teal-700">{t('monthlyUsageCalculator.navigation.continue', { defaultValue: 'Continue' })}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Button> : <Button type="submit" className="h-11 rounded-xl bg-teal-600 px-6 text-white hover:bg-teal-700"><Calculator className="h-4 w-4" />{t('monthlyUsageCalculator.calculate', { defaultValue: 'Calculate usage' })}</Button>}
                        </div>
                    </form>

                    <aside className="hidden space-y-4 lg:sticky lg:top-6 lg:block">
                        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center gap-2 text-sm font-black"><FileText className="h-4 w-4 text-teal-600" />{t('monthlyUsageCalculator.summary.title', { defaultValue: 'Your estimate so far' })}</div>
                            <div className="mt-4 space-y-3 text-sm"><SummaryRow label={t('monthlyUsageCalculator.summary.team', { defaultValue: 'Regular users' })} value={formatCount(form.teamMembers, locale)} /><SummaryRow label={t('monthlyUsageCalculator.summary.products', { defaultValue: 'Products' })} value={formatCount(form.products, locale)} /><SummaryRow label={t('monthlyUsageCalculator.summary.history', { defaultValue: 'Starting data' })} value={historyOptions.find((item) => item.value === form.historySize)?.label ?? ''} /><SummaryRow label={t('monthlyUsageCalculator.summary.batches', { defaultValue: 'Batch tracking' })} value={form.batchTracking ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} /></div>
                            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('monthlyUsageCalculator.summary.workflows', { defaultValue: 'Selected workflows' })}</div><div className="mt-2 flex flex-wrap gap-1.5">{enabledModuleLabels.length ? enabledModuleLabels.map((label) => <span key={label} className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">{label}</span>) : <span className="text-xs text-slate-400">{t('monthlyUsageCalculator.summary.none', { defaultValue: 'None yet' })}</span>}</div></div>
                        </div>
                        <div className="rounded-2xl bg-slate-900 p-4 text-sm leading-6 text-slate-200 dark:bg-black"><div className="flex items-start gap-2"><Database className="mt-1 h-4 w-4 shrink-0 text-teal-400" /><span>{t('monthlyUsageCalculator.summary.dependencies', { defaultValue: 'Child records and dependent operations are added automatically. You only answer questions a normal business user can understand.' })}</span></div></div>
                        <div className="flex items-start gap-2 rounded-2xl bg-slate-100 p-4 text-xs leading-5 text-slate-500 dark:bg-slate-900 dark:text-slate-400"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{t('monthlyUsageCalculator.localOnly', { defaultValue: 'Answers are calculated on this page and are never saved or sent.' })}</div>
                    </aside>
                </div>
            </main>
        </div>
    )
}

function CalculatorHeader({ onBack, t }: { onBack: () => void; t: ReturnType<typeof useTranslation>['t'] }) {
    return (
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
                <button type="button" onClick={onBack} className="flex items-center gap-3 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 p-2 shadow-sm dark:bg-slate-900"><img src="/logo.png" alt="Atlas" className="h-full w-full object-contain" /></div><div className="hidden sm:block"><div className="font-bold tracking-tight">Atlas</div><div className="text-xs text-slate-500 dark:text-slate-400">{t('monthlyUsageCalculator.headerLabel', { defaultValue: 'Usage estimator' })}</div></div></button>
                <div className="flex items-center gap-2"><LanguageSwitcher className="w-[112px] sm:w-[140px]" /><ThemeToggle className="hidden sm:flex" /></div>
            </div>
        </header>
    )
}

function ResultMiniMetric({ label, value }: { label: string; value: string }) {
    return <div className="rounded-2xl bg-white/12 p-3 backdrop-blur"><div className="text-[11px] font-bold uppercase tracking-wide text-teal-50/80">{label}</div><div className="mt-1 text-base font-black">{value}</div></div>
}

function Assumption({ text }: { text: string }) {
    return <li className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-600" /><span>{text}</span></li>
}

function SummaryRow({ label, value }: { label: string; value: string }) {
    return <div className="flex items-center justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">{label}</span><strong className="text-end">{value}</strong></div>
}
