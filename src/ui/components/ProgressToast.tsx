import { useTranslation } from 'react-i18next'
import { Progress } from './ui/progress'

export type ProgressToastProps = {
    fraction: number
    stageKey?: string
    page?: number
    total?: number
}

/**
 * Persistent toast content for workflows that report incremental progress,
 * such as saving and printing a PDF.
 */
export function ProgressToast({ fraction, stageKey, page, total }: ProgressToastProps) {
    const { t } = useTranslation()
    const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)))
    const stage = stageKey
        ? t(stageKey, { defaultValue: '', page, total })
        : ''

    return (
        <div className="w-full space-y-1.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{stage}</span>
                <span className="text-xs font-medium tabular-nums">{percent}%</span>
            </div>
            <Progress
                value={percent}
                className="h-1.5 bg-primary/15"
                aria-label={stage || 'Workflow progress'}
            />
        </div>
    )
}
