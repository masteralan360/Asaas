import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/ui/components/button'
import {
    getPressAndHoldProgress,
    WORKSPACE_PAYMENT_HOLD_DURATION_MS
} from '@/lib/pressAndHold'

interface PressAndHoldButtonProps extends Omit<ButtonProps, 'onClick' | 'onSubmit'> {
    onComplete: () => void
    onPressStart?: () => void
    idleLabel: string
    holdingLabel: string
    loadingLabel: string
    icon?: ReactNode
    isLoading?: boolean
    durationMs?: number
    showProgress?: boolean
}

export function PressAndHoldButton({
    onComplete,
    onPressStart,
    idleLabel,
    holdingLabel,
    loadingLabel,
    icon,
    isLoading = false,
    durationMs = WORKSPACE_PAYMENT_HOLD_DURATION_MS,
    showProgress = true,
    disabled,
    className,
    ...buttonProps
}: PressAndHoldButtonProps) {
    const [isHolding, setIsHolding] = useState(false)
    const overlayRef = useRef<HTMLSpanElement | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const completedRef = useRef(false)

    const setOverlayWidth = useCallback((width: number) => {
        if (overlayRef.current) {
            overlayRef.current.style.width = `${width}%`
        }
    }, [])

    const cancelHold = useCallback(() => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        if (!completedRef.current) {
            setIsHolding(false)
            setOverlayWidth(0)
        }
    }, [setOverlayWidth])

    const beginHold = useCallback(() => {
        if (disabled || isLoading || animationFrameRef.current !== null || completedRef.current) {
            return
        }

        onPressStart?.()

        const startedAt = performance.now()
        setIsHolding(true)
        setOverlayWidth(0)

        const updateProgress = (now: number) => {
            const next = getPressAndHoldProgress(startedAt, now, durationMs)
            setOverlayWidth(next.progress)

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
    }, [disabled, durationMs, isLoading, onComplete, onPressStart, setOverlayWidth])

    useEffect(() => {
        if (!isLoading) {
            completedRef.current = false
            setIsHolding(false)
            setOverlayWidth(0)
        }
    }, [isLoading, setOverlayWidth])

    useEffect(() => cancelHold, [cancelHold])

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
            {showProgress && (
                <span
                    ref={overlayRef}
                    aria-hidden="true"
                    className="absolute inset-y-0 start-0 bg-white/20"
                    style={{ width: '0%' }}
                />
            )}
            <span className="relative flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isLoading ? loadingLabel : (
                    <>
                        {icon}
                        {isHolding ? holdingLabel : idleLabel}
                    </>
                )}
            </span>
        </Button>
    )
}