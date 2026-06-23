import { useState, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/components/dialog'

export type HideablePrintField = {
    key: string
    label: ReactNode
    value?: ReactNode
    render?: ReactNode
    className?: string
}

interface HideablePrintFieldCardProps {
    title: ReactNode
    fields: HideablePrintField[]
    hiddenFields?: Record<string, boolean>
    onHiddenFieldChange?: (key: string, hidden: boolean) => void
    className?: string
    titleClassName?: string
    rowClassName?: string
    emptyClassName?: string
}

function renderField(field: HideablePrintField, rowClassName?: string) {
    if (field.render) return field.render

    return (
        <p className={cn(rowClassName, field.className)}>
            {field.label}
            {field.value !== undefined ? (
                <>
                    {': '}
                    {field.value}
                </>
            ) : null}
        </p>
    )
}

export function HideablePrintFieldCard({
    title,
    fields,
    hiddenFields = {},
    onHiddenFieldChange,
    className,
    titleClassName,
    rowClassName,
    emptyClassName
}: HideablePrintFieldCardProps) {
    const [open, setOpen] = useState(false)
    const canConfigure = Boolean(onHiddenFieldChange)
    const visibleFields = fields.filter((field) => !hiddenFields[field.key])

    const content = (
        <>
            <h2 className={cn('font-semibold mb-2', titleClassName)}>{title}</h2>
            {visibleFields.length > 0 ? (
                visibleFields.map((field) => (
                    <div key={field.key}>
                        {renderField(field, rowClassName)}
                    </div>
                ))
            ) : (
                <div className={cn('min-h-4', emptyClassName)} />
            )}
        </>
    )

    const openDialog = () => setOpen(true)
    const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        openDialog()
    }

    const card = canConfigure ? (
        <div
            role="button"
            tabIndex={0}
            className={cn(
                'block w-full cursor-pointer text-inherit text-center transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                className
            )}
            onClick={(event) => {
                event.stopPropagation()
                openDialog()
            }}
            onKeyDown={handleCardKeyDown}
        >
            {content}
        </div>
    ) : (
        <div className={className}>
            {content}
        </div>
    )

    if (!canConfigure) return card

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {card}
            <DialogContent
                className="max-w-md"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Select the printed values for this card.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                    {fields.map((field) => {
                        const hidden = Boolean(hiddenFields[field.key])

                        return (
                            <button
                                key={field.key}
                                type="button"
                                className={cn(
                                    'flex w-full items-start justify-between gap-4 rounded-md border border-border px-3 py-2 text-start text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                                    hidden && 'text-muted-foreground line-through'
                                )}
                                aria-pressed={hidden}
                                onClick={() => onHiddenFieldChange?.(field.key, !hidden)}
                            >
                                <span className="font-medium">{field.label}</span>
                                {field.value !== undefined ? (
                                    <span className="text-end">{field.value}</span>
                                ) : null}
                            </button>
                        )
                    })}
                </div>
            </DialogContent>
        </Dialog>
    )
}
