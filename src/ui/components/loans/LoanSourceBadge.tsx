import { Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getLoanSourceLabel } from '@/lib/loanPresentation'
import { cn } from '@/lib/utils'

export function LoanSourceBadge({
    source,
    className
}: {
    source?: string | null
    className?: string
}) {
    const { t } = useTranslation()
    const isOrder = source === 'order'

    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase',
                isOrder
                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : source === 'pos'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
                className
            )}
        >
            {isOrder ? <Receipt className="w-3 h-3" /> : null}
            {getLoanSourceLabel(source, t)}
        </span>
    )
}