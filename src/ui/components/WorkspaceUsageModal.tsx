import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
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

function getSegmentProgressColor(segment: WorkspaceUsageMeterSegment) {
    return segment.key === 'transfer'
        ? '#f59e0b'
        : 'hsl(var(--primary))'
}

function buildCircleProgressBackground(usageMeter: WorkspaceUsageMeter) {
    let cursor = 0
    const parts = usageMeter.segments.flatMap((segment) => {
        const start = cursor
        const end = Math.min(100, cursor + segment.widthPercent)
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
    const { t } = useTranslation()

    if (!usageMeter) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] w-[calc(100vw-1rem)] max-w-md overflow-hidden rounded-2xl border-border/60 p-0 shadow-2xl">
                <div className="border-b border-border/60 bg-muted/30 px-6 py-5">
                    <DialogHeader>
                        <DialogTitle className="text-base">
                            {t('workspaceUsage.modalTitle')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('workspaceUsage.modalDescription')}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="space-y-5 px-6 py-5">
                    <div className="rounded-xl border border-border/70 bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-muted-foreground">
                                {t('workspaceUsage.overall')}
                            </span>
                            <span className="text-2xl font-black tabular-nums tracking-tight text-foreground">
                                {usageMeter.label}
                            </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted ring-1 ring-border/50">
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

                    <div className="space-y-3">
                        {usageMeter.metrics.map((metric) => (
                            <div
                                key={metric.key}
                                className="rounded-xl border border-border/70 bg-background p-4 shadow-sm"
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-foreground">
                                            {metric.label}
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
                            </div>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
