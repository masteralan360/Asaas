import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/ui/components/button'
import {
    getPressAndHoldProgress,
    WORKSPACE_PAYMENT_HOLD_DURATION_MS
} from '@/lib/pressAndHold'

interface PressAndHoldButtonProps extends Omit<ButtonProps, 'onClick' | 'onSubmit'> {
    onComplete: () => void
    idleLabel: string
    holdingLabel: string
    loadingLabel: string
    isLoading?: boolean
    durationMs?: number
}

export function PressAndHoldButton({
    onComplete,
    idleLabel,
    holdingLabel,
    loadingLabel,
    isLoading = false,
    durationMs = WORKSPACE_PAYMENT_HOLD_DURATION_MS,
    disabled,
    className,
    ...buttonProps
}: PressAndHoldButtonProps) {
    const [progress, setProgress] = useState(0)
    const animationFrameRef = useRef<number | null>(null)
    const completedRef = useRef(false)

    const cancelHold = useCallback(() => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        if (!completedRef.current) {
            setProgress(0)
        }
    }, [])

    const beginHold = useCallback(() => {
        if (disabled || isLoading || animationFrameRef.current !== null || completedRef.current) {
            return
        }

        const startedAt = performance.now()
        const updateProgress = (now: number) => {
            const next = getPressAndHoldProgress(startedAt, now, durationMs)
            setProgress(next.progress)

            if (next.complete) {
                animationFrameRef.current = null
                if (completedRef.current) return
                completedRef.current = true
                onComplete()
                return
            }

            animationFrameRef.current = window.requestAnimationFrame(updateProgress)
        }

        animationFrameRef.current = window.requestAnimationFrame(updateProgress)
    }, [disabled, durationMs, isLoading, onComplete])

    useEffect(() => {
        if (!isLoading) {
            completedRef.current = false
            setProgress(0)
        }
    }, [isLoading])

    useEffect(() => cancelHold, [cancelHold])

    const isHolding = progress > 0 && progress < 100

    return (
        <Button
            {...buttonProps}
            type="button"
            allowViewer={true}
            disabled={disabled || isLoading}
            aria-label={idleLabel}
            className={`relative overflow-hidden touch-none select-none ${className ?? ''}`}
            onClick={(event) => event.preventDefault()}
            onPointerDown={(event) => {
                if (disabled || isLoading || event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                beginHold()
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onPointerLeave={cancelHold}
            onKeyDown={(event) => {
                if (disabled || isLoading || event.repeat) return
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
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 start-0 bg-white/20 transition-[width] duration-75"
                style={{ width: `${progress}%` }}
            />
            <span className="relative flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isLoading ? loadingLabel : isHolding ? holdingLabel : idleLabel}
            </span>
        </Button>
    )
}
