import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { Activity, CalendarDays, Database, Gauge, HardDrive, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceUsageInsights } from '@/lib/workspaceUsageHistory'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog'

export type WorkspaceUsageMeterSegment = {
    key: 'storage' | 'transfer'
    label: string
    percent: number
    widthPercent: number
    className: string
}

export type WorkspaceUsageMeterMetric = {
    key: 'storage' | 'transfer'
    label: string
    percent: number
    barClassName: string
    badgeClassName: string
}

export type WorkspaceUsageMeter = {
    percent: number
    label: string
    title: string
    segments: WorkspaceUsageMeterSegment[]
    metrics: WorkspaceUsageMeterMetric[]
    details: {
        storageUnits: number
        storageUnitLimit: number | null
        transferBytes: number
        transferLimitBytes: number | null
        transferPeriodStart: string
        insights: WorkspaceUsageInsights
    }
}

type WorkspaceUsageModalProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    usageMeter: WorkspaceUsageMeter | null
}

type WorkspaceUsageButtonProps = {
    usageMeter: WorkspaceUsageMeter
    onClick: () => void
    className?: string
}

type UsageStatCardProps = {
    icon: ReactNode
    label: string
    value: string
    detail: string
    toneClassName: string
}

function formatBytes(value: number | null | undefined, locale: string): string {
    const bytes = Number(value ?? 0)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    const amount = bytes / (1024 ** unitIndex)
    return `${new Intl.NumberFormat(locale, {
        maximumFractionDigits: amount >= 100 ? 0 : amount >= 10 ? 1 : 2
    }).format(amount)} ${units[unitIndex]}`
}

function formatCompactBytes(value: number, locale: string): string {
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0'
    if (bytes < 1024) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes)

    const units = ['KB', 'MB', 'GB', 'TB']
    let amount = bytes / 1024
    let unitIndex = 0
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024
        unitIndex += 1
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount)} ${units[unitIndex]}`
}

function formatDay(day: string, locale: string, options?: Intl.DateTimeFormatOptions): string {
    const date = new Date(`${day}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime())) return day
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
        ...options
    }).format(date)
}

function formatTimestamp(value: string | null, locale: string): string {
    if (!value) return '—'
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '—'
    return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(date)
}

function UsageStatCard({ icon, label, value, detail, toneClassName }: UsageStatCardProps) {
    return (
        <div className="rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {label}
                    </p>
                    <p className="mt-2 truncate text-xl font-black tabular-nums tracking-tight text-foreground">
                        {value}
                    </p>
                </div>
                <div className={cn('rounded-xl p-2.5', toneClassName)}>
                    {icon}
                </div>
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground" title={detail}>
                {detail}
            </p>
        </div>
    )
}

function getSegmentProgressColor(segment: WorkspaceUsageMeterSegment) {
    return segment.key === 'transfer'
        ? '#f59e0b'
        : 'hsl(var(--primary))'
}

function buildCircleProgressBackground(usageMeter: WorkspaceUsageMeter) {
    let cursor = 0
    const parts = usageMeter.segments.flatMap((segment) => {
        const absoluteWidth = (Math.min(100, Math.max(0, usageMeter.percent)) * segment.widthPercent) / 100
        const start = cursor
        const end = Math.min(100, cursor + absoluteWidth)
        cursor = end

        if (end <= start) return []
        return `${getSegmentProgressColor(segment)} ${start}% ${end}%`
    })

    const mutedColor = 'hsl(var(--muted))'
    if (!parts.length) {
        return mutedColor
    }

    return `conic-gradient(${parts.join(', ')}, ${mutedColor} ${cursor}% 100%)`
}

export function WorkspaceUsageButton({ usageMeter, onClick, className }: WorkspaceUsageButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex h-8 min-w-[190px] items-center gap-2 rounded-full border border-border/70 bg-background/75 px-2.5 shadow-sm backdrop-blur transition-colors hover:bg-accent/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
                className
            )}
            title={usageMeter.title}
            aria-label={usageMeter.title}
        >
            <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted ring-1 ring-border/50">
                <div
                    className="absolute inset-y-0 left-0 flex overflow-hidden transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, usageMeter.percent))}%` }}
                >
                    {usageMeter.segments.map((segment) => (
                        <div
                            key={segment.key}
                            className={cn('h-full transition-all duration-300', segment.className)}
                            style={{ width: `${segment.widthPercent}%` }}
                            title={`${segment.label}: ${Math.round(segment.percent)}%`}
                        />
                    ))}
                </div>
            </div>
            <span className="min-w-9 text-right text-[11px] font-bold tabular-nums text-foreground/80">
                {usageMeter.label}
            </span>
        </button>
    )
}

export function WorkspaceUsageCircleButton({ usageMeter, onClick, className }: WorkspaceUsageButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/75 shadow-sm backdrop-blur transition-colors hover:bg-accent/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
                className
            )}
            title={usageMeter.title}
            aria-label={usageMeter.title}
        >
            <span
                aria-hidden="true"
                className="absolute inset-1 rounded-full"
                style={{ background: buildCircleProgressBackground(usageMeter) }}
            />
            <span aria-hidden="true" className="absolute inset-[5px] rounded-full bg-background" />
            <span className="relative text-[9px] font-black tabular-nums text-foreground">
                {Math.round(usageMeter.percent)}
                <span className="text-[7px]">%</span>
            </span>
        </button>
    )
}

export function WorkspaceUsageModal({ open, onOpenChange, usageMeter }: WorkspaceUsageModalProps) {
    const { t, i18n } = useTranslation()

    if (!usageMeter) return null

    const locale = i18n.language || 'en'
    const isRtl = i18n.dir() === 'rtl'
    const { details } = usageMeter
    const { insights } = details
    const transferLimitLabel = details.transferLimitBytes === null
        ? t('workspaceUsage.unlimited')
        : formatBytes(details.transferLimitBytes, locale)
    const transferRemainingLabel = insights.remainingTransferBytes === null
        ? t('workspaceUsage.noLimit')
        : t('workspaceUsage.remainingValue', {
            value: formatBytes(insights.remainingTransferBytes, locale)
        })
    const dailyBudgetLabel = insights.dailyBudgetBytes === null
        ? '—'
        : formatBytes(insights.dailyBudgetBytes, locale)
    const numberFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] max-h-[calc(100vh-var(--titlebar-height)-var(--safe-area-top)-1rem)] w-[calc(100vw-1rem)] max-w-5xl gap-0 overflow-y-auto rounded-2xl border-border/60 p-0 shadow-2xl">
                <div className="border-b border-border/60 bg-gradient-to-br from-muted/70 via-background to-amber-500/5 px-5 py-5 sm:px-7">
                    <DialogHeader className="pe-10">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-300">
                                <Activity className="h-5 w-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl">
                                    {t('workspaceUsage.modalTitle')}
                                </DialogTitle>
                                <DialogDescription className="mt-1 max-w-2xl">
                                    {t('workspaceUsage.modalDescription')}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="mt-5 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm backdrop-blur">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground">
                                    {t('workspaceUsage.overall')}
                                </p>
                                <p className="mt-1 text-2xl font-black tabular-nums text-foreground">
                                    {usageMeter.label}
                                </p>
                            </div>
                            <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                                {formatBytes(details.transferBytes, locale)} / {transferLimitLabel}
                            </p>
                        </div>
                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted ring-1 ring-border/50">
                            <div
                                className="flex h-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, usageMeter.percent))}%` }}
                            >
                                {usageMeter.segments.map((segment) => (
                                    <div
                                        key={segment.key}
                                        className={cn('h-full transition-all duration-300', segment.className)}
                                        style={{ width: `${segment.widthPercent}%` }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-5 px-4 py-5 sm:px-7 sm:py-6">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <UsageStatCard
                            icon={<Database className="h-4 w-4" />}
                            label={t('workspaceUsage.currentTransfer')}
                            value={formatBytes(details.transferBytes, locale)}
                            detail={transferRemainingLabel}
                            toneClassName="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        />
                        <UsageStatCard
                            icon={<Activity className="h-4 w-4" />}
                            label={t('workspaceUsage.averageDaily')}
                            value={formatBytes(insights.averageDailyBytes, locale)}
                            detail={t('workspaceUsage.elapsedDaysValue', { count: insights.daysElapsed })}
                            toneClassName="bg-sky-500/10 text-sky-700 dark:text-sky-300"
                        />
                        <UsageStatCard
                            icon={<TrendingUp className="h-4 w-4" />}
                            label={t('workspaceUsage.projectedMonth')}
                            value={formatBytes(insights.projectedTransferBytes, locale)}
                            detail={t('workspaceUsage.projectionHint')}
                            toneClassName="bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        />
                        <UsageStatCard
                            icon={<Gauge className="h-4 w-4" />}
                            label={t('workspaceUsage.dailyBudget')}
                            value={dailyBudgetLabel}
                            detail={t('workspaceUsage.remainingDaysValue', { count: insights.daysRemaining })}
                            toneClassName="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        />
                    </div>

                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.75fr)]">
                        <section className="min-w-0 rounded-2xl border border-border/60 bg-background p-4 shadow-sm sm:p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">
                                        {t('workspaceUsage.consumptionTitle')}
                                    </h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {t('workspaceUsage.consumptionDescription')}
                                    </p>
                                </div>
                                <div className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold tabular-nums text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
                                    {t('workspaceUsage.peakDayValue', {
                                        value: formatBytes(insights.peakDailyBytes, locale)
                                    })}
                                </div>
                            </div>

                            <div className="mt-5 h-64 w-full" dir="ltr">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={insights.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid
                                            strokeDasharray="4 4"
                                            vertical={false}
                                            stroke="hsl(var(--border))"
                                            opacity={0.55}
                                        />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            minTickGap={24}
                                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                            tickFormatter={(value) => formatDay(String(value), locale)}
                                            reversed={isRtl}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            width={64}
                                            orientation={isRtl ? 'right' : 'left'}
                                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                            tickFormatter={(value) => formatCompactBytes(Number(value), locale)}
                                        />
                                        <RechartsTooltip
                                            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.45 }}
                                            contentStyle={{
                                                backgroundColor: 'hsl(var(--card))',
                                                border: '1px solid hsl(var(--border))',
                                                borderRadius: '12px',
                                                boxShadow: '0 10px 30px rgb(0 0 0 / 0.12)'
                                            }}
                                            labelFormatter={(label) => formatDay(String(label), locale, {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric'
                                            })}
                                            formatter={(value) => [
                                                formatBytes(Number(value), locale),
                                                t('workspaceUsage.transfer')
                                            ]}
                                        />
                                        <Bar
                                            dataKey="transferBytes"
                                            fill="#f59e0b"
                                            radius={[5, 5, 1, 1]}
                                            maxBarSize={28}
                                            isAnimationActive={false}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-border/60 bg-muted/20 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-primary" />
                                <h3 className="text-sm font-bold text-foreground">
                                    {t('workspaceUsage.periodDetails')}
                                </h3>
                            </div>
                            <dl className="mt-4 space-y-3">
                                <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-3">
                                    <dt className="text-xs text-muted-foreground">{t('workspaceUsage.periodStart')}</dt>
                                    <dd className="text-xs font-bold tabular-nums text-foreground">
                                        {formatDay(details.transferPeriodStart, locale, { year: 'numeric' })}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-3">
                                    <dt className="text-xs text-muted-foreground">{t('workspaceUsage.nextReset')}</dt>
                                    <dd className="text-xs font-bold tabular-nums text-foreground">
                                        {formatDay(insights.nextPeriodStart, locale, { year: 'numeric' })}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-3">
                                    <dt className="text-xs text-muted-foreground">{t('workspaceUsage.localTrackingStarted')}</dt>
                                    <dd className="text-xs font-bold tabular-nums text-foreground">
                                        {formatTimestamp(insights.trackedFrom, locale)}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <dt className="text-xs text-muted-foreground">{t('workspaceUsage.lastUpdated')}</dt>
                                    <dd className="text-xs font-bold tabular-nums text-foreground">
                                        {formatTimestamp(insights.lastUpdatedAt, locale)}
                                    </dd>
                                </div>
                            </dl>

                        </section>
                    </div>

                    <section>
                        <div className="mb-3 flex items-center gap-2">
                            <HardDrive className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-bold text-foreground">
                                {t('workspaceUsage.currentLimits')}
                            </h3>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            {usageMeter.metrics.map((metric) => {
                                const isStorage = metric.key === 'storage'
                                const usedLabel = isStorage
                                    ? numberFormatter.format(details.storageUnits)
                                    : formatBytes(details.transferBytes, locale)
                                const limitLabel = isStorage
                                    ? details.storageUnitLimit === null
                                        ? t('workspaceUsage.unlimited')
                                        : numberFormatter.format(details.storageUnitLimit)
                                    : transferLimitLabel

                                return (
                                    <div
                                        key={metric.key}
                                        className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm"
                                    >
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-foreground">
                                                    {metric.label}
                                                </p>
                                                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                                                    {t('workspaceUsage.usedOfLimit', {
                                                        used: usedLabel,
                                                        limit: limitLabel
                                                    })}
                                                </p>
                                            </div>
                                            <span className={cn(
                                                'inline-flex min-w-14 items-center justify-center rounded-full px-2.5 py-1 text-xs font-black tabular-nums ring-1',
                                                metric.badgeClassName
                                            )}>
                                                {Math.round(metric.percent)}%
                                            </span>
                                        </div>
                                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted ring-1 ring-border/50">
                                            <div
                                                className={cn('h-full rounded-full transition-all duration-300', metric.barClassName)}
                                                style={{ width: `${Math.min(100, Math.max(0, metric.percent))}%` }}
                                            />
                                        </div>
                                        {isStorage && (
                                            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                                <Database className="h-3 w-3" />

                                            </p>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    )
}
