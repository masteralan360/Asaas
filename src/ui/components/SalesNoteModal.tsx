import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyNote, Save, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button,
    Textarea
} from '@/ui/components'
import { type Sale } from '@/types'

interface SalesNoteModalProps {
    isOpen: boolean
    onClose: () => void
    sale: Sale | null
    onSave: (note: string) => Promise<void>
}

export function SalesNoteModal({
    isOpen,
    onClose,
    sale,
    onSave
}: SalesNoteModalProps) {
    const { t } = useTranslation()
    const [note, setNote] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const maxLength = 250

    useEffect(() => {
        if (sale) {
            setNote(sale.notes || '')
        }
    }, [sale, isOpen])

    const handleSave = async () => {
        setIsSaving(true)
        try {
            await onSave(note)
            onClose()
        } catch (error) {
            console.error('Failed to save note:', error)
        } finally {
            setIsSaving(false)
        }
    }

    if (!sale) return null

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-lg w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                "dark:bg-zinc-950/90 backdrop-blur-2xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300"
            )}>
                <div className="relative p-8 flex flex-col space-y-6">
                    {/* Background Glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-primary/10 blur-[60px] -z-10" />

                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                            <StickyNote className="w-7 h-7 text-primary" />
                        </div>
                        <div className="flex-1">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-black text-foreground tracking-tight">
                                    {sale.notes ? (t('sales.notes.editTitle') || 'Edit Sale Note') : (t('sales.notes.addTitle') || 'Add Sale Note')}
                                </DialogTitle>
                                <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
                                    {t('sales.id') || 'Sale ID'}: #{sale.sequenceId ? String(sale.sequenceId).padStart(5, '0') : sale.id.slice(0, 8)}
                                </p>
                            </DialogHeader>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="rounded-full hover:bg-muted"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </div>

                    {/* Textarea Area */}
                    <div className="space-y-2">
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value.slice(0, maxLength))}
                            placeholder={t('sales.notes.placeholder') || 'Enter internal notes for this sale...'}
                            className="min-h-[150px] rounded-2xl bg-muted/30 border-border/50 focus:ring-primary/20 resize-none font-medium leading-relaxed"
                        />
                        <div className="flex justify-between items-center px-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <span>{t('sales.notes.limit') || 'Internal Use Only'}</span>
                            <span className={cn(
                                note.length >= maxLength ? "text-destructive" : ""
                            )}>
                                {note.length} / {maxLength}
                            </span>
                        </div>
                    </div>

                    {/* Actions */}
                    <DialogFooter className="pt-2">
                        <div className="w-full grid grid-cols-2 gap-4">
                            <Button
                                variant="ghost"
                                onClick={onClose}
                                disabled={isSaving}
                                className="h-12 rounded-2xl font-bold bg-secondary/30 hover:bg-secondary/50 border border-transparent hover:border-border/50 transition-all"
                            >
                                {t('common.cancel') || 'Cancel'}
                            </Button>
                            <Button
                                onClick={handleSave}
                                disabled={isSaving || (note === (sale.notes || ''))}
                                className="h-12 rounded-2xl font-black shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 border-t border-white/10 flex gap-2 items-center justify-center transition-all active:scale-95"
                            >
                                {isSaving ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <Save className="w-4 h-4" />
                                        {t('common.save') || 'Save Note'}
                                    </>
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
