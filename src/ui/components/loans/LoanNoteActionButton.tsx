import { StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Loan } from '@/local-db'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/button'

interface LoanNoteActionButtonProps {
    loan: Pick<Loan, 'notes'>
    isReadOnly: boolean
    onClick: () => void
}

export function LoanNoteActionButton({ loan, isReadOnly, onClick }: LoanNoteActionButtonProps) {
    const { t } = useTranslation()
    const hasNote = Boolean(loan.notes?.trim())

    if (!hasNote && isReadOnly) {
        return <span className="text-muted-foreground">-</span>
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            allowViewer={hasNote}
            onClick={onClick}
            className={cn(
                'h-8 rounded-lg px-3 text-xs font-medium transition-all',
                hasNote
                    ? 'border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-muted'
            )}
        >
            <StickyNote className={cn('h-3.5 w-3.5', hasNote && 'fill-primary/20')} />
            {hasNote
                ? (t('sales.notes.viewNote') || 'View Notes..')
                : (t('sales.notes.addNote') || 'Add Note')}
        </Button>
    )
}
