import { useEffect, useState } from 'react'
import { Loader2, Save, StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { updateLoanNote, type Loan } from '@/local-db'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle
} from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { Textarea } from '@/ui/components/textarea'
import { useToast } from '@/ui/components/use-toast'

interface LoanNoteDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    loan: Loan | null
    isReadOnly: boolean
}

export function LoanNoteDialog({ open, onOpenChange, loan, isReadOnly }: LoanNoteDialogProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const [note, setNote] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const maxLength = 250

    useEffect(() => {
        if (loan && open) {
            setNote(loan.notes || '')
        }
    }, [loan, open])

    const handleSave = async () => {
        if (!loan) return

        setIsSaving(true)
        try {
            await updateLoanNote(loan.id, note)
            toast({
                title: t('sales.notes.saved') || 'Note Saved',
                description: t('sales.notes.savedLocalOnly') || 'Note saved successfully.'
            })
            onOpenChange(false)
        } catch (error: any) {
            console.error('[Loans] Failed to save note:', error)
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || 'Failed to save note.',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    if (!loan) return null

    const hasNote = Boolean(loan.notes?.trim())

    return (
        <AppDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (isSaving && !nextOpen) return
                onOpenChange(nextOpen)
            }}
        >
            <AppDialogContent
                className="max-w-lg"
                showCloseButton={!isSaving}
                onPointerDownOutside={(event) => {
                    if (isSaving) event.preventDefault()
                }}
                onInteractOutside={(event) => {
                    if (isSaving) event.preventDefault()
                }}
                onEscapeKeyDown={(event) => {
                    if (isSaving) event.preventDefault()
                }}
            >
                <AppDialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                            <StickyNote className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <AppDialogTitle>
                                {hasNote
                                    ? (t('sales.notes.editTitle') || 'Edit Loan Note')
                                    : (t('sales.notes.addTitle') || 'Add Loan Note')}
                            </AppDialogTitle>
                            <AppDialogDescription>
                                {t('loans.loanNo') || 'Loan No.'}: {loan.loanNo}
                            </AppDialogDescription>
                        </div>
                    </div>
                </AppDialogHeader>
                <AppDialogBody className="space-y-2">
                    <Textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value.slice(0, maxLength))}
                        placeholder={t('sales.notes.placeholder') || 'Enter internal notes for this loan...'}
                        disabled={isSaving || isReadOnly}
                        className="min-h-[150px] resize-none leading-relaxed"
                    />
                    <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span>{t('sales.notes.limit') || 'Internal Use Only'}</span>
                        <span>{note.length} / {maxLength}</span>
                    </div>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        {isReadOnly ? (t('common.close') || 'Close') : (t('common.cancel') || 'Cancel')}
                    </Button>
                    {!isReadOnly ? (
                        <Button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={isSaving || note === (loan.notes || '')}
                        >
                            {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                            {t('common.save') || 'Save Note'}
                        </Button>
                    ) : null}
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
