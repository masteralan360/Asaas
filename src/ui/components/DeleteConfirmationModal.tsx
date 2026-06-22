import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'

interface DeleteConfirmationModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    title?: string
    description?: string
    isLoading?: boolean
    itemName?: string
    requireHoldToConfirm?: boolean
    holdToConfirmLabel?: string
    holdDurationMs?: number
}

export function DeleteConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    isLoading = false,
    itemName = '',
    requireHoldToConfirm = false,
    holdToConfirmLabel,
    holdDurationMs = 1500
}: DeleteConfirmationModalProps) {
    const { t } = useTranslation()
    const [holdProgress, setHoldProgress] = useState(0)
    const animationFrameRef = useRef<number | null>(null)
    const holdCompletedRef = useRef(false)

    const cancelHold = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        if (!holdCompletedRef.current) {
            setHoldProgress(0)
        }
    }, [])

    const beginHold = useCallback(() => {
        if (!requireHoldToConfirm || isLoading || animationFrameRef.current !== null) return

        holdCompletedRef.current = false
        const startedAt = performance.now()

        const updateProgress = (now: number) => {
            const progress = Math.min(((now - startedAt) / holdDurationMs) * 100, 100)
            setHoldProgress(progress)

            if (progress >= 100) {
                animationFrameRef.current = null
                holdCompletedRef.current = true
                onConfirm()
                return
            }

            animationFrameRef.current = requestAnimationFrame(updateProgress)
        }

        animationFrameRef.current = requestAnimationFrame(updateProgress)
    }, [holdDurationMs, isLoading, onConfirm, requireHoldToConfirm])

    useEffect(() => {
        if (!isOpen) {
            holdCompletedRef.current = false
            cancelHold()
            setHoldProgress(0)
        }

        return cancelHold
    }, [cancelHold, isOpen])

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-md w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                "dark:bg-zinc-950/90 backdrop-blur-2xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300"
            )}>
                <div className="relative p-8 flex flex-col items-center text-center space-y-6">
                    {/* Background Glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-destructive/20 blur-[60px] -z-10" />

                    {/* Icon Container */}
                    <div className="relative">
                        <div className="w-20 h-20 rounded-[2rem] bg-destructive/10 flex items-center justify-center border border-destructive/20 animate-pulse-subtle">
                            <Trash2 className="w-10 h-10 text-destructive" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center shadow-lg">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="space-y-2">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-foreground tracking-tight text-center">
                                {title || t('common.confirmDelete') || 'Confirm Deletion'}
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground font-medium text-sm leading-relaxed px-4">
                            {description || t('common.deleteWarning') || 'This action is irreversible. Are you sure you want to proceed?'}
                        </p>
                    </div>

                    {/* Item Preview */}
                    {itemName && (
                        <div className="w-full bg-muted/30 p-4 rounded-2xl border border-border/50 flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                {t('common.targetItem') || 'Item to delete'}
                            </span>
                            <span className="text-base font-bold text-foreground truncate">
                                {itemName}
                            </span>
                        </div>
                    )}

                    {/* Actions */}
                    <DialogFooter className="w-full grid grid-cols-2 gap-3 sm:gap-4 !flex-row sm:!flex-row">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={isLoading}
                            className="h-12 rounded-2xl font-bold bg-secondary/30 hover:bg-secondary/50 border border-transparent hover:border-border/50 transition-all"
                        >
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={(event) => {
                                if (requireHoldToConfirm) {
                                    event.preventDefault()
                                    return
                                }
                                onConfirm()
                            }}
                            onPointerDown={(event) => {
                                if (!requireHoldToConfirm || event.button !== 0) return
                                event.preventDefault()
                                event.currentTarget.setPointerCapture(event.pointerId)
                                beginHold()
                            }}
                            onPointerUp={cancelHold}
                            onPointerCancel={cancelHold}
                            onPointerLeave={cancelHold}
                            onKeyDown={(event) => {
                                if (!requireHoldToConfirm || event.repeat) return
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    beginHold()
                                }
                            }}
                            onKeyUp={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    cancelHold()
                                }
                            }}
                            disabled={isLoading}
                            className="relative h-12 overflow-hidden rounded-2xl font-black shadow-lg shadow-destructive/20 bg-destructive hover:bg-destructive/90 border-t border-white/10 flex gap-2 items-center justify-center transition-all active:scale-95"
                        >
                            {requireHoldToConfirm && (
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-75"
                                    style={{ width: `${holdProgress}%` }}
                                />
                            )}
                            {isLoading ? (
                                <Loader2 className="relative w-5 h-5 animate-spin" />
                            ) : (
                                <span className="relative flex items-center justify-center gap-2">
                                    <Trash2 className="w-4 h-4" />
                                    {requireHoldToConfirm
                                        ? holdToConfirmLabel || 'Hold to delete'
                                        : t('common.delete') || 'Delete'}
                                </span>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
