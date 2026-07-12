import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
    createPriceBook,
    hardDeletePriceBook,
    updatePriceBook,
    usePriceBookCatalogState,
    type PriceBook
} from '@/local-db'
import {
    Button,
    DeleteConfirmationModal,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    useToast
} from '@/ui/components'

interface PriceBookManagementDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId?: string
    createdBy?: string | null
    enabled: boolean
}

export function PriceBookManagementDialog({
    open,
    onOpenChange,
    workspaceId,
    createdBy,
    enabled
}: PriceBookManagementDialogProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const {
        priceBooks,
        isReady: isCatalogReady,
        error: catalogError
    } = usePriceBookCatalogState(workspaceId, { enabled })
    const [name, setName] = useState('')
    const [editingPriceBook, setEditingPriceBook] = useState<PriceBook | null>(null)
    const [priceBookToDelete, setPriceBookToDelete] = useState<PriceBook | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    const sortedPriceBooks = useMemo(
        () => [...priceBooks].sort((left, right) => left.name.localeCompare(right.name)),
        [priceBooks]
    )

    useEffect(() => {
        if (!open) {
            setName('')
            setEditingPriceBook(null)
            setPriceBookToDelete(null)
            setIsSaving(false)
            setIsDeleting(false)
        }
    }, [open])

    const beginEdit = (priceBook: PriceBook) => {
        if (!isCatalogReady) {
            return
        }
        setEditingPriceBook(priceBook)
        setName(priceBook.name)
    }

    const cancelEdit = () => {
        setEditingPriceBook(null)
        setName('')
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!workspaceId || !enabled || !isCatalogReady || !name.trim()) {
            return
        }

        setIsSaving(true)
        try {
            if (editingPriceBook) {
                await updatePriceBook(editingPriceBook.id, { name })
                toast({
                    title: t('priceBooks.messages.updateSuccess', {
                        defaultValue: 'Price Book updated successfully'
                    })
                })
            } else {
                await createPriceBook(workspaceId, { name, createdBy })
                toast({
                    title: t('priceBooks.messages.createSuccess', {
                        defaultValue: 'Price Book created successfully'
                    })
                })
            }

            cancelEdit()
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || t('priceBooks.messages.saveError', {
                    defaultValue: 'Failed to save the Price Book'
                }),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleConfirmDelete = async () => {
        const priceBook = priceBookToDelete
        if (!priceBook || !enabled || isDeleting) {
            return
        }

        setIsDeleting(true)
        try {
            await hardDeletePriceBook(priceBook.id)
            if (editingPriceBook?.id === priceBook.id) {
                cancelEdit()
            }
            setPriceBookToDelete(null)
            toast({
                title: t('priceBooks.messages.deleteSuccess', {
                    defaultValue: 'Price Book deleted successfully'
                })
            })
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || t('priceBooks.messages.deleteError', {
                    defaultValue: 'Failed to delete the Price Book'
                }),
                variant: 'destructive'
            })
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <Dialog open={open && enabled} onOpenChange={(nextOpen) => !isSaving && !isDeleting && onOpenChange(nextOpen)}>
            <DialogContent className="max-w-lg overflow-hidden p-0">
                <DialogHeader className="border-b bg-muted/30 px-6 py-5 text-start">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <BookOpen className="h-5 w-5 text-primary" />
                        {t('priceBooks.title', { defaultValue: 'Price Books' })}
                    </DialogTitle>
                    <DialogDescription>
                        {t('priceBooks.managementDescription', {
                            defaultValue: 'Create and rename the pricing tiers available for products and business partners.'
                        })}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
                    <div className="space-y-2">
                        <Label htmlFor="price-book-name">
                            {t('priceBooks.name', { defaultValue: 'Price Book name' })}
                        </Label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                id="price-book-name"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder={t('priceBooks.namePlaceholder', { defaultValue: 'e.g. Wholesale' })}
                                maxLength={120}
                                autoFocus
                                required
                                disabled={!workspaceId || !isCatalogReady || isSaving || isDeleting}
                            />
                            <Button
                                type="submit"
                                disabled={isSaving || isDeleting || !isCatalogReady || !workspaceId || !name.trim()}
                                className="shrink-0 gap-2"
                            >
                                {editingPriceBook ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                {isSaving
                                    ? t('common.loading', { defaultValue: 'Loading...' })
                                    : editingPriceBook
                                        ? t('common.save', { defaultValue: 'Save' })
                                        : t('common.create', { defaultValue: 'Create' })}
                            </Button>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <div className="mb-2 text-sm font-bold">
                            {t('priceBooks.existing', { defaultValue: 'Existing Price Books' })}
                        </div>
                        {!isCatalogReady ? (
                            <div className={catalogError
                                ? 'rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive'
                                : 'rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground'}
                            >
                                {catalogError
                                    ? t('priceBooks.loadingError', {
                                        defaultValue: 'Price Books could not be loaded. Retrying automatically...'
                                    })
                                    : t('priceBooks.loading', { defaultValue: 'Loading Price Books...' })}
                            </div>
                        ) : sortedPriceBooks.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                                {t('priceBooks.empty', { defaultValue: 'No Price Books have been created yet.' })}
                            </div>
                        ) : (
                            <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
                                {sortedPriceBooks.map((priceBook) => (
                                    <div
                                        key={priceBook.id}
                                        className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2.5"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-bold">{priceBook.name}</div>
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                aria-label={t('priceBooks.edit', { defaultValue: 'Edit Price Book' })}
                                                onClick={() => beginEdit(priceBook)}
                                                disabled={!workspaceId || !isCatalogReady || isSaving || isDeleting}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                                aria-label={t('common.delete', { defaultValue: 'Delete' })}
                                                onClick={() => setPriceBookToDelete(priceBook)}
                                                disabled={!workspaceId || !isCatalogReady || isSaving || isDeleting}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="border-t pt-4 sm:justify-between">
                        {editingPriceBook ? (
                            <Button type="button" variant="ghost" onClick={cancelEdit} disabled={isSaving || isDeleting}>
                                {t('priceBooks.cancelEdit', { defaultValue: 'Cancel edit' })}
                            </Button>
                        ) : <span />}
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving || isDeleting}>
                            {t('common.close', { defaultValue: 'Close' })}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
            <DeleteConfirmationModal
                isOpen={Boolean(priceBookToDelete)}
                onClose={() => {
                    if (!isDeleting) {
                        setPriceBookToDelete(null)
                    }
                }}
                onConfirm={() => {
                    void handleConfirmDelete()
                }}
                isLoading={isDeleting}
                title={t('priceBooks.deleteConfirmTitle', { defaultValue: 'Delete Price Book?' })}
                description={t('priceBooks.deleteConfirmDescription', {
                    defaultValue: 'This permanently deletes its custom product prices and removes it from associated business partners.'
                })}
                itemName={priceBookToDelete?.name || ''}
            />
        </Dialog>
    )
}
