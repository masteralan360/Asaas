import { useState } from 'react'
import { NotebookPen } from 'lucide-react'

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Textarea
} from '@/ui/components'

type OrderLineItemNoteDialogProps = {
    note: string
    onSave: (note: string) => void
    labels: {
        trigger: string
        title: string
        description: string
        field: string
        save: string
        cancel: string
    }
}

/** Edits a note that is held in the order form until the order itself is saved. */
export function OrderLineItemNoteDialog({ note, onSave, labels }: OrderLineItemNoteDialogProps) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(note)

    const openDialog = () => {
        setDraft(note)
        setOpen(true)
    }

    const saveNote = () => {
        onSave(draft.trim())
        setOpen(false)
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className={note ? 'text-primary' : undefined}
                aria-label={labels.trigger}
                title={labels.trigger}
                onClick={openDialog}
            >
                <NotebookPen className="h-4 w-4" />
            </Button>
            <DialogContent className="sm:max-w-sm">
                <form onSubmit={(event) => {
                    event.preventDefault()
                    saveNote()
                }}>
                    <DialogHeader>
                        <DialogTitle>{labels.title}</DialogTitle>
                        <DialogDescription>{labels.description}</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="order-line-item-note">{labels.field}</Label>
                        <Textarea
                            id="order-line-item-note"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            className="mt-2 min-h-28 resize-y"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            {labels.cancel}
                        </Button>
                        <Button type="submit">{labels.save}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
